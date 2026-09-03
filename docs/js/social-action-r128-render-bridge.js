// Three.js r128 compatibility bridge for render decorators.
// r128 owns renderer.render per instance; Hobunji's body composer and social
// animation layers intentionally decorate WebGLRenderer.prototype.render.
// This adapter makes each new instance dispatch through the live prototype
// chain before calling its untouched native r128 render closure.
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const OriginalRenderer = THREE?.WebGLRenderer;
  const CTOR_MARK = '__hobunjiR128InstanceRenderDispatcher';
  const BASE_MARK = '__hobunjiR128PrototypeRenderBase';
  if (!OriginalRenderer || OriginalRenderer[CTOR_MARK]) return;

  const state = { dispatchCount: 0 };
  const proto = OriginalRenderer.prototype;
  if (typeof proto.render !== 'function') {
    const base = function hobunjiR128PrototypeRenderBase(...args) {
      const nativeRender = this?.__hobunjiR128NativeRender;
      if (typeof nativeRender !== 'function') throw new Error('Hobunji r128 render bridge lost the native renderer method.');
      return nativeRender(...args);
    };
    base[BASE_MARK] = true;
    proto.render = base;
  }

  function BridgedWebGLRenderer(...args) {
    const renderer = new OriginalRenderer(...args);
    const nativeRender = typeof renderer.render === 'function' ? renderer.render.bind(renderer) : null;
    if (!nativeRender) return renderer;
    Object.defineProperty(renderer, '__hobunjiR128NativeRender', { value: nativeRender, configurable: true });
    // Look up the prototype function at call time, not construction time: later
    // composer/social wrappers can decorate it and every existing renderer
    // instance immediately sees the new chain.
    renderer.render = function hobunjiR128InstanceRenderDispatch(...renderArgs) {
      state.dispatchCount++;
      const decorated = OriginalRenderer.prototype.render;
      return typeof decorated === 'function' ? decorated.apply(renderer, renderArgs) : nativeRender(...renderArgs);
    };
    return renderer;
  }

  BridgedWebGLRenderer.prototype = OriginalRenderer.prototype;
  Object.setPrototypeOf(BridgedWebGLRenderer, OriginalRenderer);
  Object.defineProperty(BridgedWebGLRenderer, CTOR_MARK, { value: true });
  Object.defineProperty(BridgedWebGLRenderer, '__hobunjiR128OriginalRenderer', { value: OriginalRenderer });
  THREE.WebGLRenderer = BridgedWebGLRenderer;

  global.SocialActionR128RenderBridge = Object.freeze({
    installed: true,
    getDebug: () => ({ dispatchCount: state.dispatchCount, prototypeRender: typeof OriginalRenderer.prototype.render === 'function' }),
  });
})(window);
