(() => {
  'use strict';

  const THREE = window.THREE;
  if (!THREE || window.NaturalSurfaceTextureReady?.installed) return;

  const configuredPath = window.NaturalSurfaceMaterialConfig?.texture
    || 'assets/textures/carved_smooth.png';
  const targetSuffix = String(configuredPath).split('?')[0].replace(/\\/g, '/');
  const originalLoad = THREE.TextureLoader?.prototype?.load;
  if (typeof originalLoad !== 'function') return;

  const stats = {
    interceptedLoads: 0,
    placeholderTextures: 0,
    eagerRequests: 0,
    eagerLoaded: false,
    eagerErrored: false,
  };

  // Match the average brown-gray of carved_smooth.png closely enough that
  // natural surfaces are visibly colored from their first frame. The real
  // image replaces this 1x1 canvas automatically when TextureLoader finishes.
  const placeholder = document.createElement('canvas');
  placeholder.width = 1;
  placeholder.height = 1;
  const ctx = placeholder.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#635544';
    ctx.fillRect(0, 0, 1, 1);
  }

  function isTarget(url) {
    if (!url) return false;
    const clean = String(url).split('?')[0].replace(/\\/g, '/');
    return clean.endsWith(targetSuffix) || clean.endsWith('/' + targetSuffix);
  }

  if (!originalLoad.__hobunjiNaturalSurfaceReadyWrapped) {
    function wrappedTextureLoad(url, onLoad, onProgress, onError) {
      const texture = originalLoad.call(this, url, onLoad, onProgress, onError);
      if (!isTarget(url)) return texture;

      stats.interceptedLoads++;
      // TextureLoader's async callback will replace .image with the decoded
      // source image and mark needsUpdate again. Until then, use a valid
      // colored texture instead of Three's unresolved/black sampler state.
      if (!texture.image) {
        texture.image = placeholder;
        texture.needsUpdate = true;
        stats.placeholderTextures++;
      }
      return texture;
    }
    wrappedTextureLoad.__hobunjiNaturalSurfaceReadyWrapped = true;
    wrappedTextureLoad.__hobunjiNaturalSurfaceReadyOriginal = originalLoad;
    THREE.TextureLoader.prototype.load = wrappedTextureLoad;
  }

  // Start network fetch/decode at parser time, before game.js begins building
  // farm/wilderness trees. NaturalSurfaceMaterials will use the wrapped loader
  // later; the browser coalesces/caches this same URL while every actual THREE
  // texture still gets the immediate colored placeholder above.
  const eagerImage = new Image();
  eagerImage.decoding = 'async';
  eagerImage.onload = () => { stats.eagerLoaded = true; };
  eagerImage.onerror = () => { stats.eagerErrored = true; };
  stats.eagerRequests++;
  eagerImage.src = configuredPath;

  window.NaturalSurfaceTextureReady = {
    installed: true,
    configuredPath,
    placeholder,
    eagerImage,
    snapshot() {
      return Object.assign({}, stats, {
        eagerComplete: !!eagerImage.complete,
        eagerNaturalWidth: Number(eagerImage.naturalWidth || 0),
      });
    },
  };
})();
