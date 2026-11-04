// Applies Furniture Author v2 surface PNG overrides to the exact exported triangle faces.
// Legacy furniture keeps its procedural/rock material path untouched; newly edited surfaces opt in.
(() => {
  'use strict';
  const THREE = window.THREE;
  if (!THREE || window.FurnitureSurfacePngRuntime) return;
  const canvasCache = new Map(); // Reuses decoded and padded PNG art across copies of the same authored furniture.
  const textureCache = new Map(); // Reuses GPU textures between identical furniture instances instead of allocating one per face.
  const stats = { applied: 0, pending: 0, failed: 0, skipped: 0, lastError: '' }; // Mobile-readable diagnostics for texture loading and face mapping.
  const limit = (value, low, high) => Math.max(low, Math.min(high, Number(value) || 0));

  function resolveSource(source) {
    const value = String(source || '').trim();
    if (/^(?:data:image\/|blob:|https?:\/\/)/i.test(value)) return value;
    const pathAt = value.indexOf('assets/');
    if (pathAt >= 0) return (window.__hobunjiFurnitureAssetBase || 'assets/') + value.slice(pathAt + 7);
    return value;
  }

  function decodeCanvas(settings) {
    const source = resolveSource(settings.source);
    if (!source) return Promise.reject(new Error('Missing surface PNG source'));
    const rotation = ((Math.round(Number(settings.rotationDeg || 0) / 90) * 90) % 360 + 360) % 360;
    const paddingX = limit(settings.paddingX, 0, .45), paddingY = limit(settings.paddingY, 0, .45);
    const key = JSON.stringify([source, rotation, paddingX, paddingY, !!settings.fillEnabled, settings.fillColor]);
    if (canvasCache.has(key)) return canvasCache.get(key);
    const pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onerror = () => reject(new Error('Could not load '+source.slice(0, 110)));
      image.onload = () => {
        try {
          const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height, sideways = rotation === 90 || rotation === 270;
          const rotatedWidth = sideways ? ih : iw, rotatedHeight = sideways ? iw : ih;
          const scale = Math.min(1, 4096 * (1-2*paddingX) / rotatedWidth, 4096 * (1-2*paddingY) / rotatedHeight); // Prevent large PNG+45% padding from exceeding mobile texture limits.
          const scaledW = Math.max(1, Math.floor(iw * scale)), scaledH = Math.max(1, Math.floor(ih * scale));
          const rotated = document.createElement('canvas');
          rotated.width = sideways ? scaledH : scaledW;
          rotated.height = sideways ? scaledW : scaledH;
          const ctx = rotated.getContext('2d');
          if (!ctx) throw new Error('2D texture canvas unavailable');
          ctx.save();
          if (rotation === 90) { ctx.translate(rotated.width, 0); ctx.rotate(Math.PI / 2); }
          else if (rotation === 180) { ctx.translate(rotated.width, rotated.height); ctx.rotate(Math.PI); }
          else if (rotation === 270) { ctx.translate(0, rotated.height); ctx.rotate(-Math.PI / 2); }
          ctx.drawImage(image, 0, 0, scaledW, scaledH);
          ctx.restore();
          let sourceCanvas = rotated;
          if (settings.fillEnabled && /^#[0-9a-f]{6}$/i.test(settings.fillColor || '') && typeof window.getShadeFillCanvas === 'function') {
            const hex = settings.fillColor.slice(1);
            sourceCanvas = window.getShadeFillCanvas(rotated, 'surface:'+key, {
              mode:'shadeFill', rgb:[0,2,4].map(offset => parseInt(hex.slice(offset,offset+2),16)),
              options: window.getPortraitTintingConfig?.(),
            }) || rotated;
          }
          if (!paddingX && !paddingY) { resolve(sourceCanvas); return; }
          const padded = document.createElement('canvas');
          padded.width = Math.max(1, Math.ceil(sourceCanvas.width / (1 - 2 * paddingX)));
          padded.height = Math.max(1, Math.ceil(sourceCanvas.height / (1 - 2 * paddingY)));
          padded.getContext('2d').drawImage(sourceCanvas, Math.floor((padded.width-sourceCanvas.width)/2), Math.floor((padded.height-sourceCanvas.height)/2));
          resolve(padded);
        } catch (error) { reject(error); }
      };
      image.src = source;
    }).catch(error => { canvasCache.delete(key); throw error; });
    canvasCache.set(key, pending);
    return pending;
  }

  function sharedSurfaceTexture(settings, repeatU, repeatV) {
    const key = JSON.stringify([resolveSource(settings.source),settings.rotationDeg,settings.paddingX,settings.paddingY,!!settings.fillEnabled,settings.fillColor,repeatU,repeatV]);
    if (!textureCache.has(key)) {
      const task = decodeCanvas(settings).then(canvas => {
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        texture.wrapS = repeatU ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        texture.wrapT = repeatV ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        return texture;
      }).catch(error => { textureCache.delete(key); throw error; });
      textureCache.set(key, task);
    }
    return textureCache.get(key);
  }

  function applyToPart(mesh, data, part) {
    if (!mesh?.isMesh || !mesh.geometry?.getAttribute || !part || part.rockShape?.enabled) return false;
    // The gameplay sphere/torus, GLB and liquid builders do not share the Furniture Editor's triangle indexing.
    // Never apply author face indices to an incompatible geometry: that can texture unrelated faces or hide a puzzle surface.
    const compatibleKinds = ['box','beam','legSquare','legRound','cylinder','disc','barrel','cup'];
    if (!compatibleKinds.includes(part.kind)) return false;
    const candidates = (data?.recognizedSurfaces || []).filter(surface => {
      const settings = data.surfaceSettings?.[surface.id]?.texture || surface.texture;
      return surface.partId === part.id && Number(settings?.version) >= 2 && !!settings.source && Array.isArray(surface.faceIndices) && Array.isArray(surface.basisU) && Array.isArray(surface.basisV);
    });
    if (!candidates.length) return false;
    const originalGeometry = mesh.geometry;
    const geometry = originalGeometry.index ? originalGeometry.toNonIndexed() : originalGeometry.clone(); // Each editable face must own its UVs.
    const positions = geometry.getAttribute('position'), count = Math.floor(positions?.count / 3);
    if (!positions || !count || !mesh.material || Array.isArray(mesh.material)) { geometry.dispose(); stats.skipped++; return false; }
    const uv = geometry.getAttribute('uv')?.array ? new Float32Array(geometry.getAttribute('uv').array) : new Float32Array(positions.count*2);
    const faceMaterial = new Uint16Array(count); // Face-to-material mapping protects every non-edited surface.
    const materials = [mesh.material]; // Index 0 retains the original material, texture and shader.
    let applied = 0;
    for (const surface of candidates) {
      const settings = data.surfaceSettings?.[surface.id]?.texture || surface.texture;
      const indices = surface.faceIndices.filter(i => Number.isInteger(i) && i >= 0 && i < count && faceMaterial[i] === 0);
      const b = surface.bounds || {};
      const bounds = [Number(b.minU),Number(b.maxU),Number(b.minV),Number(b.maxV)];
      if (!indices.length || !bounds.every(Number.isFinite)) { stats.skipped++; continue; }
      const tile = Math.max(.02, Number(settings.tileSize) || 1);
      const originU = (bounds[0]+bounds[1])*.5, originV = (bounds[2]+bounds[3])*.5;
      const width = Math.max(.000001, bounds[1]-bounds[0]), height = Math.max(.000001, bounds[3]-bounds[2]);
      const repeatU = settings.mapping === 'tile' || settings.mapping === 'tile-x';
      const repeatV = settings.mapping === 'tile' || settings.mapping === 'tile-y';
      const bx = surface.basisU, by = surface.basisV;
      const material = mesh.material.clone();
      const opacity = limit(settings.opacity == null ? 1 : settings.opacity, 0, 1);
      material.opacity = opacity;
      material.transparent = settings.transparent !== false || opacity < .999 || (Number(settings.paddingX)||0) > 0 || (Number(settings.paddingY)||0) > 0;
      material.alphaTest = material.transparent ? .035 : 0; // Fully transparent pixels are actual holes, not invisible depth occluders.
      material.depthWrite = opacity >= .999; // Opaque net-like cutouts still contribute correct wall/furniture depth.
      material.side = THREE.DoubleSide;
      material.userData = { ...material.userData, surfacePngDisposed:false };
      material.addEventListener?.('dispose', () => { material.userData.surfacePngDisposed = true; });
      const materialIndex = materials.push(material) - 1;
      for (const face of indices) {
        faceMaterial[face] = materialIndex;
        for (let corner = 0; corner < 3; corner++) {
          const v = face*3 + corner;
          const x = positions.getX(v), y = positions.getY(v), z = positions.getZ(v);
          const rawU = x*bx[0]+y*bx[1]+z*bx[2], rawV = x*by[0]+y*by[1]+z*by[2];
          uv[v*2] = repeatU ? (rawU-originU)/tile : (rawU-bounds[0])/width;
          uv[v*2+1] = repeatV ? (rawV-originV)/tile : (rawV-bounds[2])/height;
        }
      }
      // Preserve the original material until the new image is ready; one missing PNG cannot blank a furniture piece.
      stats.pending++;
      sharedSurfaceTexture(settings,repeatU,repeatV).then(texture => {
        if (material.userData?.surfacePngDisposed) return;
        material.map = texture;
        material.color.set(0xffffff);
        material.needsUpdate = true;
        stats.applied++;
      }).catch(error => { stats.failed++; stats.lastError = String(error); console.warn('[FurnitureSurfacePngRuntime]', error); })
        .finally(() => { stats.pending--; });
      applied++;
    }
    if (!applied) { materials.slice(1).forEach(mat => mat.dispose()); geometry.dispose(); return false; }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv,2));
    geometry.clearGroups();
    for (let start = 0; start < count;) {
      const value = faceMaterial[start];
      let end = start+1;
      while (end < count && faceMaterial[end] === value) end++;
      geometry.addGroup(start*3,(end-start)*3,value);
      start = end;
    }
    mesh.geometry = geometry;
    mesh.material = materials;
    mesh.userData ||= {};
    mesh.userData.authoredSurfacePngCount = applied; // Pixel Probe and mobile debug can verify the authored surface renderer took ownership.
    originalGeometry.dispose();
    return true;
  }

  window.FurnitureSurfacePngRuntime = Object.freeze({
    applyToPart,
    debugSnapshot: () => ({ ...stats, cachedCanvases:canvasCache.size, cachedTextures:textureCache.size }),
  });
})();
