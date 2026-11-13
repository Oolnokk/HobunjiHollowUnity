(() => {
  'use strict';

  // Saves and restores the depth of a rectangle of the current render target
  // with WebGL2 framebuffer blits, so a pass that must temporarily rebuild
  // depth there (HeldObjectRenderOrder's held/shell x-ray replays) can put the
  // original back by copying it instead of redrawing the whole scene.
  //
  // Only an offscreen, single-sample WebGLRenderTarget with a depth texture is
  // supported (the game's main scene target while outlines are on). Anything
  // else reports unsupported and the caller keeps its redraw path. One
  // depth(-stencil) renderbuffer of the target's size is kept per renderer.
  //
  // three r128 caches its framebuffer binding outside WebGLState, so every
  // raw bind here is undone by rebinding the target's own framebuffer, which
  // is exactly what three still believes is bound.
  const states = new WeakMap(); // renderer -> { fbo, rbo, width, height, internal, attachment, broken }
  const stats = { saves: 0, restores: 0, unsupported: 0, allocations: 0, disabledReason: 'none' };

  function describe(gl, THREE, target) {
    const depth = target?.depthTexture;
    if (!depth) return null;
    if (depth.format === THREE.DepthStencilFormat) return { internal: gl.DEPTH24_STENCIL8, attachment: gl.DEPTH_STENCIL_ATTACHMENT };
    if (depth.format !== THREE.DepthFormat) return null;
    if (depth.type === THREE.UnsignedShortType) return { internal: gl.DEPTH_COMPONENT16, attachment: gl.DEPTH_ATTACHMENT };
    if (depth.type === THREE.UnsignedIntType) return { internal: gl.DEPTH_COMPONENT24, attachment: gl.DEPTH_ATTACHMENT };
    if (depth.type === THREE.FloatType) return { internal: gl.DEPTH_COMPONENT32F, attachment: gl.DEPTH_ATTACHMENT };
    return null;
  }

  function fail(state, reason) {
    if (state) state.broken = true;
    stats.disabledReason = reason;
    return null;
  }

  // Resolves everything one save/restore pair needs, or null when this target
  // cannot be snapshotted.
  function resolve(renderer) {
    const THREE = window.THREE;
    const gl = renderer?.getContext?.();
    const target = renderer?.getRenderTarget?.() || null;
    if (!THREE || !gl || !target || !renderer.capabilities?.isWebGL2 || typeof gl.blitFramebuffer !== 'function'
        || target.isWebGLMultisampleRenderTarget || target.isWebGLCubeRenderTarget || !(target.width > 0 && target.height > 0)) {
      stats.unsupported++;
      return null;
    }
    const source = renderer.properties?.get?.(target)?.__webglFramebuffer;
    if (!source) { stats.unsupported++; return null; }
    let state = states.get(renderer);
    if (state?.broken) return null;
    const format = describe(gl, THREE, target);
    if (!format) { stats.unsupported++; return null; }
    if (!state) { state = { fbo: null, rbo: null, width: 0, height: 0, internal: 0, attachment: 0, broken: false }; states.set(renderer, state); }
    if (!state.fbo || state.width !== target.width || state.height !== target.height || state.internal !== format.internal) {
      if (state.fbo) gl.deleteFramebuffer(state.fbo);
      if (state.rbo) gl.deleteRenderbuffer(state.rbo);
      state.rbo = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, state.rbo);
      gl.renderbufferStorage(gl.RENDERBUFFER, format.internal, target.width, target.height);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      state.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, format.attachment, gl.RENDERBUFFER, state.rbo);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, source); // Back to what three believes is bound.
      state.width = target.width; state.height = target.height; state.internal = format.internal; state.attachment = format.attachment;
      state.checked = false;
      stats.allocations++;
      if (status !== gl.FRAMEBUFFER_COMPLETE) return fail(state, 'incomplete-framebuffer');
    }
    return { gl, state, source, width: target.width, height: target.height };
  }

  // rect is {x, y, z: width, w: height} in framebuffer pixels (a THREE.Vector4
  // scissor rectangle); null/undefined copies the whole target.
  function blit(resolved, rect, toScratch) {
    const { gl, state, source, width, height } = resolved;
    const x0 = rect ? Math.max(0, Math.floor(rect.x)) : 0, y0 = rect ? Math.max(0, Math.floor(rect.y)) : 0;
    const x1 = rect ? Math.min(width, Math.ceil(rect.x + rect.z)) : width, y1 = rect ? Math.min(height, Math.ceil(rect.y + rect.w)) : height;
    if (!(x1 > x0 && y1 > y0)) return true; // Empty rectangle: nothing to copy.
    const scissor = gl.isEnabled(gl.SCISSOR_TEST); // A blit is clipped by the draw framebuffer's scissor.
    if (scissor) gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, toScratch ? source : state.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, toScratch ? state.fbo : source);
    gl.blitFramebuffer(x0, y0, x1, y1, x0, y0, x1, y1, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, source); // Read and draw both back on the target, as three expects.
    if (scissor) gl.enable(gl.SCISSOR_TEST);
    if (!state.checked) { // One synchronous error check per allocation, not per frame.
      state.checked = true;
      if (gl.getError() !== gl.NO_ERROR) { fail(state, 'blit-error'); return false; }
    }
    return true;
  }

  // Copies the rectangle's depth out of the current render target. Returns a
  // token for restore(), or null when unsupported (caller must redraw instead).
  function save(renderer, rect) {
    const resolved = resolve(renderer);
    if (!resolved) return null;
    renderer.state?.buffers?.depth?.setMask?.(true);
    if (!blit(resolved, rect, true)) return null;
    stats.saves++;
    return { target: renderer.getRenderTarget(), state: resolved.state, width: resolved.width, height: resolved.height };
  }

  // Copies the saved depth back. Returns false if the target changed since
  // save() (the caller must then rebuild depth the slow way).
  function restore(renderer, token, rect) {
    if (!token || renderer.getRenderTarget?.() !== token.target) return false;
    const resolved = resolve(renderer);
    if (!resolved || resolved.state !== token.state || resolved.width !== token.width || resolved.height !== token.height) return false;
    renderer.state?.buffers?.depth?.setMask?.(true);
    if (!blit(resolved, rect, false)) return false;
    stats.restores++;
    return true;
  }

  window.ScissorDepthSnapshot = Object.freeze({ save, restore, snapshot: () => ({ ...stats }) });
})();
