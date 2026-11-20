// Portrait-relative 3D beard and side-hair rig. Cosmetics without portraitSplineRig stay flat.
(() => {
  'use strict';

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
  const RAD = Math.PI / 180;
  const DEFAULT_BONE = Object.freeze({yaw:8,pitch:10,roll:18}); // One root-to-tip joint drives each accessory, no six-direction poses.
  const SLOT_NAMES = new Set(['facialHair', 'hairSide', 'hairSideL']);
  const live = new Set(); // Mobile diagnostics; entries are removed by the avatar's disposal hook.

  const MASK_SIZE = 200; // Rigid/flexible pixel regions are authored in the same 200×200 portrait coordinate system as cosmetic PNGs.
  function normalizePixelMask(input) {
    if (!input || Number(input.size) !== MASK_SIZE || !Array.isArray(input.runs)) return null;
    const total = MASK_SIZE * MASK_SIZE;
    const spans = input.runs.slice(0, total).filter(pair => Array.isArray(pair) && pair.length === 2
      && Number.isInteger(pair[0]) && Number.isInteger(pair[1]) && pair[0] >= 0 && pair[1] > 0 && pair[0] < total)
      .map(([start, length]) => [start, Math.min(length, total - start)]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [start, length] of spans) {
      const last = merged[merged.length - 1];
      if (last && start <= last[0] + last[1]) last[1] = Math.max(last[1], start + length - last[0]);
      else merged.push([start, length]);
    }
    return { size: MASK_SIZE, runs: merged }; // Sparse RLE remains tiny for hair outlines, yet is pixel-accurate.
  }
  function decodePixelMask(input) {
    const bits = new Uint8Array(MASK_SIZE * MASK_SIZE); // Temporary editor/runtime bitset; serialized JSON stores only contiguous rigid runs.
    const mask = normalizePixelMask(input);
    for (const [start, length] of mask?.runs || []) bits.fill(1, start, start + length);
    return bits;
  }
  function encodePixelMask(bits) {
    const runs = [];
    for (let i = 0; i < MASK_SIZE * MASK_SIZE;) {
      if (!bits[i]) { i++; continue; }
      const start = i;
      while (i < bits.length && bits[i]) i++;
      runs.push([start, i - start]);
    }
    return { size: MASK_SIZE, runs };
  }
  function maskFromOverlap(sprite, head, options = {}) {
    if (!sprite || !head) return null;
    const canvas = document.createElement('canvas'); // Normalizes indexed, tint-composited artwork into portrait UV space before alpha comparisons.
    canvas.width = canvas.height = MASK_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(sprite, Math.round(finite(options.dx) * MASK_SIZE), Math.round(finite(options.dy) * MASK_SIZE), MASK_SIZE, MASK_SIZE);
    const hair = ctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data;
    ctx.clearRect(0, 0, MASK_SIZE, MASK_SIZE);
    ctx.drawImage(head, 0, 0, MASK_SIZE, MASK_SIZE);
    const skin = ctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data;
    const bits = new Uint8Array(MASK_SIZE * MASK_SIZE);
    for (let i = 0; i < bits.length; i++) bits[i] = hair[i * 4 + 3] >= 128 && skin[i * 4 + 3] >= 128 ? 1 : 0;
    return encodePixelMask(bits); // All hair/head overlap starts rigid; everything else starts flexible.
  }
  function paintPixelMask(input, u, v, radiusPx, rigid, previous) {
    const bits = decodePixelMask(input);
    const x = clamp(finite(u), 0, 1) * MASK_SIZE;
    const y = clamp(finite(v), 0, 1) * MASK_SIZE;
    const startX = clamp(finite(previous?.u, x / MASK_SIZE), 0, 1) * MASK_SIZE;
    const startY = clamp(finite(previous?.v, y / MASK_SIZE), 0, 1) * MASK_SIZE;
    const dx = x - startX, dy = y - startY; // Span between pointer samples in portrait pixels.
    const lengthSquared = dx * dx + dy * dy;
    const radius = clamp(finite(radiusPx, 3), .5, 60);
    const minX = Math.max(0, Math.floor(Math.min(startX, x) - radius));
    const maxX = Math.min(MASK_SIZE - 1, Math.floor(Math.max(startX, x) + radius));
    const minY = Math.max(0, Math.floor(Math.min(startY, y) - radius));
    const maxY = Math.min(MASK_SIZE - 1, Math.floor(Math.max(startY, y) + radius));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const offsetX = px + .5 - startX, offsetY = py + .5 - startY;
        const t = lengthSquared ? clamp((offsetX * dx + offsetY * dy) / lengthSquared, 0, 1) : 0;
        if ((offsetX - t * dx) ** 2 + (offsetY - t * dy) ** 2 <= radius * radius)
          bits[py * MASK_SIZE + px] = rigid ? 1 : 0;
      }
    }
    return encodePixelMask(bits);
  }
  function attachmentPinField(mask) {
    const bits = decodePixelMask(mask);
    return bits.includes(1) ? bits : null;
  }
  function maskPixel(u, v) {
    return clamp(Math.floor(v * MASK_SIZE), 0, MASK_SIZE - 1) * MASK_SIZE
      + clamp(Math.floor(u * MASK_SIZE), 0, MASK_SIZE - 1);
  }
  function isPinnedPixel(field, u, v) {
    return field?.[maskPixel(u, v)] === 1;
  }
  function attachmentMotion(field, u, v) {
    if (!field) return 1;
    if (isPinnedPixel(field, u, v)) return 0;
    const x = u * MASK_SIZE, y = v * MASK_SIZE;
    let distance = 2; // Only the first two pixels outside the hard mask soften in 3D.
    for (let py = Math.max(0, Math.floor(y - 2)); py < Math.min(MASK_SIZE, Math.ceil(y + 2)); py++) {
      for (let px = Math.max(0, Math.floor(x - 2)); px < Math.min(MASK_SIZE, Math.ceil(x + 2)); px++) {
        if (!field[py * MASK_SIZE + px]) continue;
        distance = Math.min(distance, Math.hypot(Math.max(0, px - x, x - px - 1), Math.max(0, py - y, y - py - 1)));
      }
    }
    const t = distance / 2;
    return t * t * (3 - 2 * t);
  }

  function strandGeometry(THREE, rig, width, height, rear = false) {
    const head = attachmentPinField(rig.regionMasks?.[rear ? 'rear' : 'front']);
    const overlap = rear ? null : attachmentPinField(rig.hoodOverlapMask);
    const rigidOverlap = rear ? null : attachmentPinField(rig.hoodRigidOverlapMask);
    const authoredHole = rear ? null : attachmentPinField(rig.hoodOpeningMask);
    if ((!head && !overlap && !rigidOverlap && !authoredHole) || !THREE.BufferGeometry)
      return new THREE.PlaneGeometry(width,height,rig.segmentsX,rig.segmentsY);
    // Refine only the vicinity the elastic aperture could reach, rather than
    // making every NPC hair mesh 200×200. This gives pinning a vertex at each
    // rim pixel so cloth and hair do not pull apart under wind.
    let hoodZone=null;
    if(authoredHole){
      hoodZone=new Uint8Array(MASK_SIZE*MASK_SIZE);
      const queue=new Uint16Array(hoodZone.length),distance=new Uint8Array(hoodZone.length);
      distance.fill(255);
      let next=0,front=0;
      for(let i=0;i<authoredHole.length;i++)if(authoredHole[i]){
        distance[i]=0;hoodZone[i]=1;queue[next++]=i;
      }
      const reach=clamp(Math.round(finite(rig.hoodStretchPx,12)),0,32)+2;
      for(;front<next;front++){
        const i=queue[front],step=distance[i]+1;
        if(step>reach)continue;
        const x=i%MASK_SIZE,y=(i/MASK_SIZE)|0;
        for(const neighbor of [x?i-1:-1,x<MASK_SIZE-1?i+1:-1,
          y?i-MASK_SIZE:-1,y<MASK_SIZE-1?i+MASK_SIZE:-1]){
          if(neighbor<0||distance[neighbor]<=step)continue;
          distance[neighbor]=step;hoodZone[neighbor]=1;queue[next++]=neighbor;
        }
      }
    }
    const columns = rig.segmentsX, rows = rig.segmentsY;
    const xs = Array.from({ length: columns + 1 }, (_, i) => Math.round(i * MASK_SIZE / columns));
    const ys = Array.from({ length: rows + 1 }, (_, i) => Math.round(i * MASK_SIZE / rows));
    const refined = new Uint8Array(columns * rows); // Subdivide near mask edges, including tiny disconnected flexible islands.
    const needsPixels = (x, y, right, bottom) => {
      const first = maskPixel((rear ? MASK_SIZE - x - .5 : x + .5) / MASK_SIZE, (y + .5) / MASK_SIZE);
      for (let py = y; py < bottom; py++) for (let px = x; px < right; px++) {
        const i = py * MASK_SIZE + (rear ? MASK_SIZE - 1 - px : px);
        if (hoodZone?.[i] || head?.[i] !== head?.[first]
          || overlap?.[i] !== overlap?.[first] || rigidOverlap?.[i] !== rigidOverlap?.[first]) return true;
      }
      return false;
    };
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      refined[row * columns + col] = needsPixels(Math.max(0, xs[col] - 2), Math.max(0, ys[row] - 2),
        Math.min(MASK_SIZE, xs[col + 1] + 2), Math.min(MASK_SIZE, ys[row + 1] + 2));
    }
    const vertices = new Map(), positions = [], uv = [], indices = []; // Shared boundary vertices prevent gaps between mesh resolutions.
    const vertex = (x, y) => {
      const key = y * 2 * (MASK_SIZE * 2 + 1) + x * 2;
      if (vertices.has(key)) return vertices.get(key);
      const index = positions.length / 3;
      vertices.set(key, index);
      positions.push((x / MASK_SIZE - .5) * width, (.5 - y / MASK_SIZE) * height, 0);
      uv.push(x / MASK_SIZE, 1 - y / MASK_SIZE);
      return index;
    };
    const cell = (x, y, right, bottom, topFine, rightFine, bottomFine, leftFine) => {
      const perimeter = [vertex(x, y)];
      if (leftFine) for (let py = y + 1; py < bottom; py++) perimeter.push(vertex(x, py));
      perimeter.push(vertex(x, bottom));
      if (bottomFine) for (let px = x + 1; px < right; px++) perimeter.push(vertex(px, bottom));
      perimeter.push(vertex(right, bottom));
      if (rightFine) for (let py = bottom - 1; py > y; py--) perimeter.push(vertex(right, py));
      perimeter.push(vertex(right, y));
      if (topFine) for (let px = right - 1; px > x; px--) perimeter.push(vertex(px, y));
      const center = vertex((x + right) / 2, (y + bottom) / 2);
      for (let i = 0; i < perimeter.length; i++) indices.push(center, perimeter[i], perimeter[(i + 1) % perimeter.length]);
    };
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const i = row * columns + col;
      if (refined[i]) {
        for (let y = ys[row]; y < ys[row + 1]; y++) for (let x = xs[col]; x < xs[col + 1]; x++) {
          cell(x, y, x + 1, y + 1);
        }
      } else {
        cell(xs[col], ys[row], xs[col + 1], ys[row + 1], refined[i - columns],
          col + 1 < columns && refined[i + 1], refined[i + columns], col > 0 && refined[i - 1]);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    return geometry;
  }

  function selectHoodOpening(hood, u, v, mask) {
    const alpha = hood.getContext('2d').getImageData(0, 0, MASK_SIZE, MASK_SIZE).data;
    const first = maskPixel(u, v);
    const visited = new Uint8Array(MASK_SIZE * MASK_SIZE);
    const queue = new Uint16Array(visited.length); // Flood the clicked transparent region once, using edge-adjacent pixels.
    let count = 0;
    function visit(index) {
      if (visited[index] || alpha[index * 4 + 3] >= 8) return;
      visited[index] = 1;
      queue[count++] = index;
    }
    visit(first);
    if (!count) return { reason: 'cloth' };
    for (let i = 0; i < count; i++) {
      const index = queue[i];
      const x = index % MASK_SIZE, y = Math.floor(index / MASK_SIZE);
      if (x === 0 || y === 0 || x === MASK_SIZE - 1 || y === MASK_SIZE - 1) return { reason: 'outside' };
      visit(index - 1); visit(index + 1);
      visit(index - MASK_SIZE); visit(index + MASK_SIZE);
    }
    const selected = decodePixelMask(mask);
    let added = 0;
    for (let i = 0; i < count; i++) {
      added += 1 - selected[queue[i]];
      selected[queue[i]] = 1;
    }
    return { mask: encodePixelMask(selected), added };
  }

  function fitHood(hood, rig, beardCanvases = []) {
    if (!hood) return null;
    const ctx=hood.getContext('2d'),image=ctx.getImageData(0,0,MASK_SIZE,MASK_SIZE);
    const source=new Uint8ClampedArray(image.data); // The original hood colors remain the warp source, never already-cleared pixels.
    const painted=decodePixelMask(rig.hoodOpeningMask);
    const aperture=new Uint8Array(MASK_SIZE*MASK_SIZE); // Actual elastic hole, exported for GPU clipping and motion pinning.
    const hair=new Uint8Array(aperture.length); // Union of all beard layers in portrait UVs; no canvas size assumptions.
    const stretch=clamp(Math.round(finite(rig.hoodStretchPx,12)),0,32);
    for(const canvas of beardCanvases){
      if(!canvas)continue;
      let reference=canvas;
      if(canvas.width!==MASK_SIZE||canvas.height!==MASK_SIZE){
        reference=document.createElement('canvas');reference.width=reference.height=MASK_SIZE;
        reference.getContext('2d').drawImage(canvas,0,0,MASK_SIZE,MASK_SIZE);
      }
      const pixels=reference.getContext('2d').getImageData(0,0,MASK_SIZE,MASK_SIZE).data;
      for(let i=0;i<hair.length;i++)if(pixels[i*4+3]>=8)hair[i]=1;
    }
    const queue=new Uint16Array(aperture.length),distance=new Uint8Array(aperture.length);
    distance.fill(255);
    let tail=0,head=0;
    for(let i=0;i<painted.length;i++){
      if(!painted[i])continue;
      // Authored openings are seeds, not arbitrary transparent cuts through the hood.
      // A clicked transparent hole may sit one or two pixels beside the beard's edge.
      if(hair[i]){if(distance[i]!==0){distance[i]=0;aperture[i]=1;queue[tail++]=i;}continue;}
      const x=i%MASK_SIZE,y=(i/MASK_SIZE)|0;
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        if(Math.abs(dx)+Math.abs(dy)>2)continue;
        const xx=x+dx,yy=y+dy;
        if(xx<0||yy<0||xx>=MASK_SIZE||yy>=MASK_SIZE)continue;
        const at=yy*MASK_SIZE+xx;
        if(hair[at]&&distance[at]===255){distance[at]=0;aperture[at]=1;queue[tail++]=at;}
      }
    }
    // A four-connected flood across *real hair pixels* expands the opening into an
    // elastic fit around its silhouette, bounded so it never carves a remote hole.
    for(;head<tail;head++){
      const i=queue[head],next=distance[i]+1;
      if(next>stretch)continue;
      const x=i%MASK_SIZE,y=(i/MASK_SIZE)|0;
      for(const at of [x?i-1:-1,x<MASK_SIZE-1?i+1:-1,y?i-MASK_SIZE:-1,y<MASK_SIZE-1?i+MASK_SIZE:-1]){
        if(at<0||!hair[at]||distance[at]<=next)continue;
        distance[at]=next;aperture[at]=1;queue[tail++]=at;
      }
    }
    const core=aperture.slice();
    // One-pixel clearance prevents bilinear sampling of a black hood edge across a beard pixel.
    for(let i=0;i<core.length;i++)if(core[i]){
      const x=i%MASK_SIZE,y=(i/MASK_SIZE)|0;
      if(x)aperture[i-1]=1;
      if(x<MASK_SIZE-1)aperture[i+1]=1;
      if(y)aperture[i-MASK_SIZE]=1;
      if(y<MASK_SIZE-1)aperture[i+MASK_SIZE]=1;
    }
    let stretchedPixels=0,openingPixels=0,minX=MASK_SIZE,maxX=-1,minY=MASK_SIZE,maxY=-1;
    for(let i=0;i<aperture.length;i++){
      if(!aperture[i])continue;
      image.data[i*4+3]=0;openingPixels++;
      const x=i%MASK_SIZE,y=(i/MASK_SIZE)|0;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    }
    // Draw a continuous cloth rim around the reshaped hole: pixels still owned
    // by the hood can sample neighboring original cloth, but never sample the new void.
    const rim=4;
    for(let y=Math.max(0,minY-rim);y<=Math.min(MASK_SIZE-1,maxY+rim);y++)
      for(let x=Math.max(0,minX-rim);x<=Math.min(MASK_SIZE-1,maxX+rim);x++){
      const i=y*MASK_SIZE+x;
      if(aperture[i]||source[i*4+3]<8)continue;
      let nearest=-1,best=rim*rim+1;
      for(let dy=-rim;dy<=rim;dy++)for(let dx=-rim;dx<=rim;dx++){
        const px=x+dx,py=y+dy,d=dx*dx+dy*dy;
        if(px<0||py<0||px>=MASK_SIZE||py>=MASK_SIZE||d>=best||d>rim*rim)continue;
        const j=py*MASK_SIZE+px;
        if(aperture[j]){best=d;nearest=j;}
      }
      if(nearest<0||best===0)continue;
      const dx=x-nearest%MASK_SIZE,dy=y-((nearest/MASK_SIZE)|0);
      const distanceFromRim=Math.sqrt(best),pull=(rim-distanceFromRim)/rim;
      const sx=clamp(Math.round(x-dx*pull*.7),0,MASK_SIZE-1);
      const sy=clamp(Math.round(y-dy*pull*.7),0,MASK_SIZE-1);
      const at=sy*MASK_SIZE+sx;
      if(source[at*4+3]<8)continue; // Never smear transparent black into the resized aperture.
      image.data.set(source.subarray(at*4,at*4+4),i*4);stretchedPixels++;
    }
    if(openingPixels||stretchedPixels)ctx.putImageData(image,0,0);
    const overlap=decodePixelMask(rig.hoodOverlapMask),rigidOverlap=decodePixelMask(rig.hoodRigidOverlapMask);
    const coverage=new Uint8Array(aperture.length);
    for(let i=0;i<coverage.length;i++){
      coverage[i]=image.data[i*4+3]>=8?1:0;
      overlap[i]=coverage[i]?(rigidOverlap[i]?2:overlap[i]):0;
    }
    return {canvas:hood,coverage,overlap,aperture,openingPixels,stretchedPixels};
  }

  function hoodOcclusion(THREE, material) {
    const uniform = { value: null }; // One packed nearest-filtered map carries hood coverage and overlap permission.
    const prior = material.onBeforeCompile;
    material.onBeforeCompile = function (shader, renderer) {
      prior?.call(this, shader, renderer);
      shader.uniforms.splineHoodMask = uniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 splineHoodPosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nsplineHoodPosition = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 splineHoodPosition;
          uniform sampler2D splineHoodMask;
          uniform vec2 splinePortraitSize;
          uniform vec3 splineEye;
          uniform vec3 splineViewDirection;
          uniform bool splineOrthographic;
        `)
        .replace('#include <map_fragment>', `#include <map_fragment>
          // Intersect the sightline toward the camera with the actual hood plane.
          // A hood pixel can hide hair only if it lies BETWEEN the hair and eye.
          vec3 hoodTowardEye = splineOrthographic ? splineViewDirection : splineEye - splineHoodPosition;
          if (abs(hoodTowardEye.z) > 0.00001 && texture2D(splineHoodMask, vUv).g < 0.5) {
            float hoodRayStep = -splineHoodPosition.z / hoodTowardEye.z;
            if (hoodRayStep > 0.00001 && (splineOrthographic || hoodRayStep < 1.0)) {
              vec2 hoodUV = (splineHoodPosition.xy + hoodTowardEye.xy * hoodRayStep) / splinePortraitSize + 0.5;
              if (all(greaterThanEqual(hoodUV, vec2(0.0))) && all(lessThanEqual(hoodUV, vec2(1.0)))
                  && texture2D(splineHoodMask, hoodUV).r > 0.5) discard;
            }
          }
        `);
      shader.uniforms.splinePortraitSize = size;
      shader.uniforms.splineEye = eye;
      shader.uniforms.splineViewDirection = direction;
      shader.uniforms.splineOrthographic = orthographic;
    };
    const size = { value: new THREE.Vector2(1, 1) }; // Used to map deformed model coordinates back to the hood portrait.
    const eye = { value: new THREE.Vector3() }; // Perspective eye in strand-local coordinates.
    const direction = { value: new THREE.Vector3() }; // Parallel ray used by orthographic game cameras.
    const orthographic = { value: false };
    const inverse = new THREE.Matrix4(); // Reused by the render callback for both camera types.
    let texture = null;
    return {
      setCamera(mesh, camera) {
        inverse.copy(mesh.matrixWorld).invert();
        orthographic.value = camera.isOrthographicCamera === true;
        if (orthographic.value) {
          direction.value.setFromMatrixColumn(camera.matrixWorld, 2).transformDirection(inverse);
        } else {
          eye.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse);
        }
      },
      update(fit, width, height) {
        size.value.set(width, height);
        if (!fit && !texture) return;
        if (!fit) { texture.image.data.fill(0); texture.needsUpdate = true; return; }
        if (!texture) {
          texture = new THREE.DataTexture(new Uint8Array(MASK_SIZE * MASK_SIZE * 4), MASK_SIZE, MASK_SIZE, THREE.RGBAFormat);
          texture.minFilter = texture.magFilter = THREE.NearestFilter;
          uniform.value = texture;
        }
        const data = texture.image.data;
        for (let i = 0; i < fit.coverage.length; i++) {
          const x = i % MASK_SIZE, y = Math.floor(i / MASK_SIZE);
          const at = ((MASK_SIZE - 1 - y) * MASK_SIZE + x) * 4;
          data[at] = fit.coverage[i] * 255;
          data[at + 1] = fit.overlap[i] ? 255 : 0;
        }
        texture.needsUpdate = true;
      },
      dispose() { texture?.dispose(); },
    };
  }
  function prepareSplineTexture(canvas, rearView = false) {
    if(!canvas)return null;
    const source=document.createElement('canvas'); // One contiguous uncut sprite per front/rear appendage, unlike the previous two-sheet seam.
    source.width=canvas.width;source.height=canvas.height;
    const ctx=source.getContext('2d',{willReadFrequently:true});
    if(rearView){ctx.translate(source.width,0);ctx.scale(-1,1);}
    ctx.drawImage(canvas,0,0,source.width,source.height);
    // A two-pixel color gutter prevents bilinear sampling of transparent black PNG texels.
    // Only RGB in transparent pixels changes; tiny alpha (1/255) preserves RGB through canvas upload
    // and is discarded by the existing .02 alphaTest, leaving the original silhouette unchanged.
    const image=ctx.getImageData(0,0,source.width,source.height),pixels=image.data;
    let colors=new Uint8Array(pixels.length),eligible=new Uint8Array(source.width*source.height);
    colors.set(pixels);
    for(let i=0;i<eligible.length;i++)eligible[i]=pixels[i*4+3]>=8 ? 1 : 0;
    const adjacent=[[-1,0],[1,0],[0,-1],[0,1]]; // Reuse a fixed four-neighbor table instead of allocating one for every transparent texel.
    for(let pass=0;pass<2;pass++){
      const nextColors=new Uint8Array(colors),nextEligible=new Uint8Array(eligible);
      for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
        const i=y*source.width+x;
        if(eligible[i])continue;
        for(const [dx,dy] of adjacent){
          const xx=x+dx,yy=y+dy;
          if(xx<0||yy<0||xx>=source.width||yy>=source.height)continue;
          const j=yy*source.width+xx;
          if(!eligible[j])continue;
          nextColors.set(colors.subarray(j*4,j*4+3),i*4);
          nextEligible[i]=1;break;
        }
      }
      colors=nextColors;eligible=nextEligible;
    }
    for(let i=0;i<eligible.length;i++){
      if(!eligible[i]||pixels[i*4+3]>=8)continue;
      pixels[i*4]=colors[i*4];pixels[i*4+1]=colors[i*4+1];pixels[i*4+2]=colors[i*4+2];
      pixels[i*4+3]=1;
    }
    ctx.putImageData(image,0,0);
    return source;
  }
  function defaultBone(points) {
    const root=points?.[0],tip=points?.[points.length-1];
    const length=root&&tip?Math.hypot(tip.u-root.u,tip.v-root.v):.2;
    const scale=clamp(length/.26,.45,1.4); // Short moustaches bend less than long hanging beards.
    return {yaw:Math.round(DEFAULT_BONE.yaw*scale),pitch:Math.round(DEFAULT_BONE.pitch*scale),
      roll:Math.round(DEFAULT_BONE.roll*scale)};
  }

  function suggestRestPoints(sprite, head) {
    if (!sprite?.width || !sprite?.height) return null;
    const c=document.createElement('canvas');c.width=c.height=MASK_SIZE;
    const ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(sprite,0,0,MASK_SIZE,MASK_SIZE);
    const art=ctx.getImageData(0,0,MASK_SIZE,MASK_SIZE).data;
    let skin=null;
    if(head){ctx.clearRect(0,0,MASK_SIZE,MASK_SIZE);ctx.drawImage(head,0,0,MASK_SIZE,MASK_SIZE);skin=ctx.getImageData(0,0,MASK_SIZE,MASK_SIZE).data;}
    let minY=MASK_SIZE,maxY=-1,minX=MASK_SIZE,maxX=-1,overlapX=0,overlapY=0,overlapCount=0;
    const rowSum=new Float64Array(MASK_SIZE),rowCount=new Uint16Array(MASK_SIZE); // Portrait-space strand centerline inferred from visible art, no per-species fixed coordinates.
    for(let y=0;y<MASK_SIZE;y++)for(let x=0;x<MASK_SIZE;x++){
      const k=(y*MASK_SIZE+x)*4;
      if(art[k+3]<16)continue;
      minY=Math.min(minY,y);maxY=Math.max(maxY,y);minX=Math.min(minX,x);maxX=Math.max(maxX,x);
      rowSum[y]+=x;rowCount[y]++;
      if(skin && skin[k+3]>=16){overlapX+=x;overlapY+=y;overlapCount++;}
    }
    if(maxY<0) return null;
    const rootY=overlapCount?clamp(Math.round(overlapY/overlapCount),minY,Math.min(maxY,minY+Math.round((maxY-minY)*.5))):minY;
    const tipY=maxY;
    const centerAt=y=>{
      for(let gap=0;gap<MASK_SIZE;gap++){
        if(y-gap>=0&&rowCount[y-gap])return rowSum[y-gap]/rowCount[y-gap];
        if(y+gap<MASK_SIZE&&rowCount[y+gap])return rowSum[y+gap]/rowCount[y+gap];
      }
      return (minX+maxX)*.5;
    };
    const rootX=overlapCount?overlapX/overlapCount:centerAt(rootY);
    const points=[
      {u:clamp((rootX+.5)/MASK_SIZE,0,1),v:(rootY+.5)/MASK_SIZE,depth:.012},
      {u:clamp((centerAt(tipY)+.5)/MASK_SIZE,0,1),v:(tipY+.5)/MASK_SIZE,depth:.032},
    ];
    if(points[1].v-points[0].v<.035) return null; // A tiny accessory keeps a user-authored bone instead of a degenerate pivot.
    return points;
  }

  function normalize(input) {
    if (!input || input.enabled === false || !Array.isArray(input.points) || input.points.length < 2) return null;
    // Old multi-knot assets migrate at load: preserve the root and final tip, drop every blend-space segment.
    const points=[input.points[0],input.points[input.points.length-1]].map((point,i)=>({
      u:clamp(finite(point?.u,.5),0,1),v:clamp(finite(point?.v,.5+i*.2),0,1),
      depth:clamp(finite(point?.depth,.012+i*.02),-.35,.35), // Signed depth lets authored beard geometry pass behind its owner's portrait.
    }));
    if(Math.hypot(points[1].u-points[0].u,points[1].v-points[0].v)<.005)return null;
    const defaults=defaultBone(points),raw=input.bone||{};
    const bone=Object.fromEntries(['yaw','pitch','roll'].map(axis=>[axis,
      clamp(finite(raw[axis],defaults[axis]),0,65)])); // Maximum physical swing in degrees for a unit gust.
    return {
      version:2,enabled:true,points,bone,
      regionMasks:Object.fromEntries(['front','rear'].flatMap(view=>{
        const mask=normalizePixelMask(input.regionMasks?.[view]);return mask?[[view,mask]]:[];
      })),
      hoodOpeningMask:normalizePixelMask(input.hoodOpeningMask),
      hoodOverlapMask:normalizePixelMask(input.hoodOverlapMask),
      hoodRigidOverlapMask:normalizePixelMask(input.hoodRigidOverlapMask),
      hoodStretchPx:clamp(Math.round(finite(input.hoodStretchPx,12)),0,32),
      rearOffset:{u:clamp(finite(input.rearOffset?.u),-.25,.25),
        v:clamp(finite(input.rearOffset?.v),-.25,.25)},
      width:clamp(finite(input.width,.1),.01,.5),
      windResponse:clamp(finite(input.windResponse,1),0,5),
      segmentsX:clamp(Math.round(finite(input.segmentsX,24)),4,40),
      segmentsY:clamp(Math.round(finite(input.segmentsY,32)),4,48),
    };
  }

  function resolveOptionRig(option, fighter) {
    const key = String(fighter?.speciesId || '') + '_' + String(fighter?.gender || '');
    return normalize(option?.variantSplineRigs?.[key] || option?.splineRig);
  }

  function posePoints(rig, wind = {}) {
    const root=rig.points[0],tip=rig.points[1],rest=[
      {x:root.u-.5,y:.5-root.v,z:root.depth},
      {x:tip.u-.5,y:.5-tip.v,z:tip.depth},
    ];
    const x=clamp(finite(wind.x),-1,1),y=clamp(finite(wind.y),-1,1),z=clamp(finite(wind.z),-1,1);
    const bone=rig.bone||defaultBone(rig.points);
    // Exactly one joint: rotate the root-to-tip vector; the attachment itself never moves.
    const angles={yaw:bone.yaw*x,pitch:bone.pitch*(.35*y-z),roll:bone.roll*(x+.3*y)};
    const end=segmentVector(root,tip,angles,1),base=rest[0],target={
      x:base.x+end.x,y:base.y+end.y,z:base.z+end.z,
    };
    let collisions=0;
    if(root.depth>=.003 && tip.depth>=.003 && target.z<.003){
      collisions=1;
      const start=rest[1],denominator=start.z-target.z;
      const fraction=denominator>0?clamp((start.z-.003)/denominator,0,1):0;
      target.x=start.x+(target.x-start.x)*fraction;
      target.y=start.y+(target.y-start.y)*fraction;
      target.z=Math.max(.003,start.z+(target.z-start.z)*fraction);
    }
    return {points:[base,target],collisions};
  }
  function segmentVector(from,to,angles,factor) {
    const yaw=angles.yaw*RAD*factor,pitch=angles.pitch*RAD*factor,roll=angles.roll*RAD*factor;
    const dx=to.u-from.u,dy=from.v-to.v,dz=to.depth-from.depth;
    const x1=dx*Math.cos(yaw)+dz*Math.sin(yaw),z1=dz*Math.cos(yaw)-dx*Math.sin(yaw);
    const y2=dy*Math.cos(pitch)-z1*Math.sin(pitch),z2=dy*Math.sin(pitch)+z1*Math.cos(pitch);
    return {x:x1*Math.cos(roll)-y2*Math.sin(roll),y:x1*Math.sin(roll)+y2*Math.cos(roll),z:z2};
  }

  function curvePoint(points, index, fraction, normalized = false) {
    const a=points[0],b=points[1],t=clamp(fraction,0,1);
    const get=(p,axis)=>normalized?(axis==='x'?p.u-.5:axis==='y'?.5-p.v:p.depth):p[axis];
    return Object.fromEntries(['x','y','z'].map(axis=>[axis,get(a,axis)*(1-t)+get(b,axis)*t]));
  }

  function deformPosition(rig, posed, u, v, width, height, pinned = false, motion = pinned ? 0 : 1, overlap = 0, covered = 0) {
    const x = u - .5, y = .5 - v;
    const behindHood = covered && !overlap; // Only real opaque hood pixels (outside its stretched opening) hide the attached strand.
    if (pinned || overlap === 2) return { x: x * width, y: y * height,
      z: (behindHood ? -.0008 : .0008) * height };
    let index = 0, fraction = 0, closest = Infinity;
    for (let i = 0; i < rig.points.length - 1; i++) {
      const a = rig.points[i], b = rig.points[i + 1];
      const ax = a.u - .5, ay = .5 - a.v, bx = b.u - .5, by = .5 - b.v;
      const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
      const t = clamp(len ? ((x - ax) * dx + (y - ay) * dy) / len : 0, 0, 1);
      const squared = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
      if (squared < closest) { closest = squared; index = i; fraction = t; }
    }
    const rest = curvePoint(rig.points, 0, fraction, true); // One bone: linear root-to-tip interpolation.
    const target = curvePoint(posed, 0, fraction); // Same single-joint shape for all wind directions.
    const influence = (1 - clamp(Math.sqrt(closest) / Math.max(.01, rig.width), 0, 1) ** 2) * motion;
    const authoredDepth = rest.z + (target.z - rest.z) * influence;
    const z = behindHood ? Math.min(-.003, authoredDepth)
      : overlap ? Math.max(.003, authoredDepth) : authoredDepth;
    return { x: (x + (target.x - rest.x) * influence) * width,
      y: (y + (target.y - rest.y) * influence) * height,
      // A partly anchored edge must stay BEHIND the cloth for every motion weight, not fade back through z=0.
      z: (behindHood ? -.0008 + (z + .0008) * motion
        : .0008 + (z - .0008) * motion) * height };
  }

  const OWNER_DEPTH_EPSILON = 0.01; // Beard renders immediately before its owner's portrait so depth, not sprite layers, determines mutual visibility.
  function pairOwnerDepthOrder(mesh, owner) {
    if (!owner || !mesh) return;
    let fallback = Number(mesh.renderOrder) || 0; // Used when a custom renderer replaces the owner's order with an invalid value.
    Object.defineProperty(mesh, 'renderOrder', {
      configurable: true, enumerable: true,
      get() {
        const order = Number(owner.renderOrder);
        return (Number.isFinite(order) ? order : fallback) - OWNER_DEPTH_EPSILON;
      },
      set(value) {
        if (Number.isFinite(Number(value))) fallback = Number(value);
      },
    }); // Read during Three.js render-list sorting, not after sorting in onBeforeRender.
    mesh.userData.portraitSplineOwnerDepth = { paired: true, owner: owner.name || 'portrait', beforeOwner: true };
  }

  function makePart(THREE, front, rear, width, height, name, ownerPortrait = null) {
    const rig = front.rig, geometry = strandGeometry(THREE, rig, width, height);
    const base = new Float32Array(geometry.attributes.position.array); // Stable rest data reused by every wind update.
    const rearGeometry = rear?.canvas ? strandGeometry(THREE, rig, width, height, true) : null;
    const rearBase = rearGeometry?.attributes.position.array.slice(); // The rear-facing strand must sit BEHIND the rear portrait, not behind the front camera.
    const makeTexture = (canvas, rearView) => {
      const source=prepareSplineTexture(canvas,rearView);
      const shared=window.HobunjiSpritePngSurface; // Same canonical PNG-plane color management as Pants and the main avatar.
      const texture=shared?.makeCanvasTexture?.(THREE,source,'portrait_spline_continuous')
        ||new THREE.CanvasTexture(source);
      if(THREE.SRGBColorSpace)texture.colorSpace=THREE.SRGBColorSpace;
      else if(THREE.sRGBEncoding)texture.encoding=THREE.sRGBEncoding;
      texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;
      texture.needsUpdate=true;
      return texture;
    };
    const makeMesh = (canvas, back) => {
      const ownerMaterial = Array.isArray(ownerPortrait?.material)
        ? ownerPortrait.material[back ? 1 : 0] || ownerPortrait.material[0]
        : ownerPortrait?.material;
      const ownerAlpha = Number(ownerMaterial?.alphaTest);
      const material = new THREE.MeshBasicMaterial({ map: makeTexture(canvas, back), transparent: true,
        alphaTest: Math.max(.02,Number.isFinite(ownerAlpha) ? ownerAlpha : .35),
        side: back ? THREE.BackSide : THREE.FrontSide, depthTest: true, depthWrite: true });
      // This is a real alpha-tested 3D surface. Its nearest fragments must write depth
      // before the owner's PNG is drawn; neither side gets a forced x-ray overlay.
      material.toneMapped = false;
      const mesh = new THREE.Mesh(back ? rearGeometry : geometry, material);
      mesh.name = name + (back ? '_rear' : '_front');
      mesh.renderOrder = 1.99; mesh.frustumCulled = false;
      pairOwnerDepthOrder(mesh, ownerPortrait); // Follows actor ordering, including live NPC rank and owner-specific compositor updates.
      mesh.userData.noOutline = true; // A 2D cosmetic ribbon must not get a large solid 3D outline shell.
      return mesh;
    };
    const frontMesh = makeMesh(front.canvas, false);
    const rearMesh = rear?.canvas ? makeMesh(rear.canvas, true) : null;
    const rest = geometry.attributes.position;
    const frontPins=attachmentPinField(rig.regionMasks?.front);
    const rearPins=rearGeometry?attachmentPinField(rig.regionMasks?.rear):null;
    const rearPositions = rearGeometry?.attributes.position || null; // Same authored UV-to-spline mapping, with mirrored depth relative to the rear plane.
    const frontMotion = new Float32Array(rest.count); // Cached attachment weights for the live wind loop.
    const frontPixels = new Uint16Array(rest.count); // Reuse mask indices for the per-frame hood overlap check.
    const rearMotion = rearGeometry ? new Float32Array(rearPositions.count) : null;
    for (let i = 0; i < rest.count; i++) {
      const u = base[i * 3] / width + .5, v = .5 - base[i * 3 + 1] / height;
      frontMotion[i] = attachmentMotion(frontPins, u, v);
      frontPixels[i] = maskPixel(u, v);
      if (frontMotion[i] === 0) rest.setXYZ(i, base[i * 3], base[i * 3 + 1], .0008 * height);
    }
    if (rearMotion) for (let i = 0; i < rearMotion.length; i++) {
      rearMotion[i] = attachmentMotion(rearPins, .5 - rearBase[i * 3] / width, .5 - rearBase[i * 3 + 1] / height);
      if (rearMotion[i] === 0) rearPositions.setXYZ(i, rearBase[i * 3], rearBase[i * 3 + 1], -.0008 * height);
    }
    let hoodFit = null, occlusion = null;
    let lastTime = -Infinity, lastX = NaN, lastY = NaN, lastZ = NaN;
    const applyWind = (wind = { x: 0, y: 0, z: 0 }, force = false) => {
      if (!force && Math.abs(wind.x - lastX) + Math.abs(wind.y - lastY) + Math.abs(wind.z - lastZ) < .025) return;
      lastX = wind.x; lastY = wind.y; lastZ = wind.z;
      const posed = posePoints(rig, wind);
      for (let i = 0; i < rest.count; i++) {
        const u = base[i * 3] / width + .5, v = .5 - base[i * 3 + 1] / height;
        if (frontMotion[i] === 0 && !force) continue; // Rigid pixels need re-seating only when the hood is added, changed, or removed.
        const pixel=frontPixels[i],motion=hoodFit?.aperture?.[pixel]?0:frontMotion[i]; // The strand at the elastic hood opening stays seated even in a gust.
        const p=deformPosition(rig,posed.points,u,v,width,height,frontMotion[i]===0,motion,
          hoodFit?.overlap?.[pixel] || 0,hoodFit?.coverage?.[pixel] || 0);
        rest.setXYZ(i,p.x,p.y,p.z);
      }
      if(rearPositions) for (let i = 0; i < rearPositions.count; i++) {
        const u = rearBase[i * 3] / width + .5, v = .5 - rearBase[i * 3 + 1] / height;
        if (rearMotion[i] === 0) continue;
        const back=deformPosition(rig,posed.points,u,v,width,height,false,rearMotion[i]);
        rearPositions.setXYZ(i,back.x,back.y,-back.z);
      }
      rest.needsUpdate = true;
      if (rearPositions) rearPositions.needsUpdate = true; // Both strand meshes opt out of frustum culling.
      frontMesh.userData.portraitSplineCollisionLimits = posed.collisions;
    };
    const update = () => {
      const wind = window.DeadzoneBillboard?.liveVegetationWindSnapshot?.();
      if (!wind || wind.time === lastTime) return;
      lastTime = wind.time;
      const strength = clamp(wind.strength / .12, 0, 1) * rig.windResponse;
      const phase = finite(front.phase, 0);
      applyWind({ x: clamp(Math.sin(wind.time * 1.6 + phase) * strength, -1, 1),
        y: clamp(Math.cos(wind.time * .85 + phase * 1.7) * strength * .35, -1, 1),
        z: clamp(Math.sin(wind.time * 1.1 + phase * 2) * strength * .5, -1, 1) });
    };
    const setHood = fit => {
      if (fit === hoodFit) return;
      hoodFit = fit || null;
      if (hoodFit && !occlusion) {
        occlusion = hoodOcclusion(THREE, frontMesh.material);
        frontMesh.material.needsUpdate = true;
        frontMesh.userData.disposeSplineHood = () => occlusion.dispose();
      }
      occlusion?.update(hoodFit, width, height);
      // A new aperture can change even when the hood overlap flags do not.
      // Re-seat every affected strand vertex immediately instead of waiting for the next gust.
      applyWind({x:Number.isFinite(lastX)?lastX:0,y:Number.isFinite(lastY)?lastY:0,
        z:Number.isFinite(lastZ)?lastZ:0},true);
    };
    applyWind({ x: 0, y: 0, z: 0 }, true);
    if (front.hoodFit) setHood(front.hoodFit);
    frontMesh.onBeforeRender = (_renderer, _scene, camera) => {
      update();
      if (hoodFit) occlusion.setCamera(frontMesh, camera);
    };
    if (rearMesh) rearMesh.onBeforeRender = update;
    return { frontMesh, rearMesh, applyWind, setHood, rig, name };
  }

  function attach(THREE, root, assembly, frontCanvas, backCanvas, modelWidth, modelHeight) {
    if (!THREE || !root || !assembly) return [];
    root.userData.portraitSplineAttachment = { THREE, assembly, modelWidth, modelHeight }; // Supports cosmetic changes after the avatar was built without a 3D hairstyle.
    const parts = Array.isArray(frontCanvas?.hobunjiSplineParts) ? frontCanvas.hobunjiSplineParts : [];
    if (!parts.length) { root.userData.portraitSplineParts = []; return []; }
    const rears = new Map((backCanvas?.hobunjiSplineParts || []).map(p => [p.key, p]));
    const joint = root.userData?.portraitSplineHeadBone || root.userData?.neckRig?.headScaleJoint || null;
    const host = joint || assembly;
    const holder = new THREE.Group(); holder.name = 'portrait_spline_appendages';
    if (joint) {
      const pivot = root.userData.portraitSplineNeckLocal || root.userData.neckRig?.neckLocal;
      holder.position.set(-finite(pivot?.x), -finite(pivot?.y), 0);
    }
    host.add(holder);
    root.userData.portraitSplineHolder = holder; // Owned by this avatar and removed when its selected hairstyle changes.
    // Use the actual color-rendering portrait, never a depth-helper or shoulder overlay.
    // Skinned carriers have one front/back material array; rigid carriers have front/back meshes.
    const ownerPortrait = root.userData?.neckRig?.skinnedPlane
      || assembly.children?.find(mesh => mesh?.name === 'npc_avatar_front_plane')
      || assembly.children?.find(mesh => mesh?.isMesh && !mesh.userData?.portraitSplineOwnerDepth)
      || null;
    const attached = [];
    for (const part of parts) {
      if (!part.rig || !part.canvas) continue;
      const rendered = makePart(THREE, part, part.slot === 'facialHair' ? null : rears.get(part.key), modelWidth, modelHeight, part.key, ownerPortrait);
      holder.add(rendered.frontMesh);
      if (rendered.rearMesh) holder.add(rendered.rearMesh);
      rendered.signature = JSON.stringify(part.rig); // Compare authored geometry/motion without recreating on ordinary breathing refreshes.
      attached.push(rendered);
    }
    root.userData.portraitSplineParts = attached; // World-space/mobile debug and optional authored pose controls.
    live.add(root);
    return attached;
  }

  function discardPieces(root) {
    const holder = root?.userData?.portraitSplineHolder;
    if (!holder) return;
    const materials = new Set(), geometries = new Set();
    holder.traverse(mesh => {
      mesh.userData?.disposeSplineHood?.();
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(mat => materials.add(mat));
    });
    holder.parent?.remove(holder);
    for (const geometry of geometries) geometry.dispose?.();
    for (const material of materials) { material.map?.dispose?.(); material.dispose?.(); }
    root.userData.portraitSplineHolder = null;
    root.userData.portraitSplineParts = [];
    live.delete(root);
  }

  function refresh(root, frontCanvas, backCanvas) {
    if (!root) return;
    const requested = Array.isArray(frontCanvas?.hobunjiSplineParts) ? frontCanvas.hobunjiSplineParts : [];
    const active = root.userData?.portraitSplineParts || [];
    const byName = new Map(active.map(part => [part.name, part]));
    const changed = requested.length !== active.length || requested.some(part => {
      const current = byName.get(part.key);
      return !current || current.signature !== JSON.stringify(part.rig);
    });
    if (changed) {
      discardPieces(root);
      const owner = root.userData?.portraitSplineAttachment;
      if (owner && requested.length) attach(owner.THREE, root, owner.assembly, frontCanvas, backCanvas, owner.modelWidth, owner.modelHeight);
      return;
    }
    const fronts = new Map(requested.map(p => [p.key, p]));
    const rears = new Map((backCanvas?.hobunjiSplineParts || []).map(p => [p.key, p]));
    for (const part of active) {
      const f = fronts.get(part.name), b = rears.get(part.name);
      part.setHood(f?.hoodFit);
      for (const [mesh, canvas] of [[part.frontMesh, f?.canvas], [part.rearMesh, b?.canvas]]) {
        if (!mesh || !canvas) continue;
        const image = mesh.material.map.image;
        if (!image?.getContext) continue;
        const source=prepareSplineTexture(canvas,mesh===part.rearMesh); // Wardrobe refresh retains the same anti-dark-edge gutter as first creation.
        const c=image.getContext('2d');
        c.clearRect(0,0,image.width,image.height);
        c.drawImage(source,0,0,image.width,image.height);
        mesh.material.map.needsUpdate=true;
      }
    }
  }

  function detach(root) { discardPieces(root); } // Hostile 3D appendages may live outside the old avatar's mesh tree.
  function debug() {
    return [...live].map(root => ({
      name: root.name, active: root.userData?.portraitSplineParts?.length || 0,
      pieces: (root.userData?.portraitSplineParts || []).map(p => ({
        name: p.name, collisionLimits: p.frontMesh.userData.portraitSplineCollisionLimits,
        rear: !!p.rearMesh,
        ownerDepth: p.frontMesh.userData.portraitSplineOwnerDepth || null,
        frontDepthTest: p.frontMesh.material.depthTest, frontDepthWrite: p.frontMesh.material.depthWrite,
        frontRenderOrder: p.frontMesh.renderOrder,
        signedDepth: (() => {
          const values = p.frontMesh.geometry.attributes.position.array;
          let front = 0, rear = 0;
          for (let i = 2; i < values.length; i += 3) values[i] < 0 ? rear++ : front++;
          return { frontVertices:front, behindOwnerVertices:rear };
        })(), // Computed only when the developer requests mobile diagnostics, not per-frame.
      })),
    }));
  }
  window.PortraitSplineRig = { normalize, resolveOptionRig, defaultBone, posePoints, curvePoint,
    sampleHoodOverlap: (fit, u, v) => fit?.overlap[maskPixel(u, v)] || 0,
    deformPosition, attachmentPinField, isPinnedPixel, attachmentMotion, strandGeometry, selectHoodOpening, fitHood, hoodOcclusion, prepareSplineTexture, suggestRestPoints,
    normalizePixelMask, decodePixelMask, encodePixelMask, maskFromOverlap, paintPixelMask,
    attach, refresh, detach, debug };
})();
