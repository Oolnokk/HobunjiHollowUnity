(() => {
  'use strict';

  // Central registry for furniture/lantern-mask point lights: game.js's
  // makeFurniturePointLight, and the inline PointLight creations in
  // bandit-camps.js, porakaneki-camps-runtime.js and deadzone-billboard.js
  // that also tag userData.furnitureLightMask, all register() here at
  // creation. WeatherFX's lantern-glow overlay (see game.js's
  // getFurnitureLightSources) used to find these by traversing the whole
  // active scene every couple of seconds — real, avoidable cost in a
  // decor-dense area since it scales with total scene size, not light
  // count. list() below walks only this small registry instead.
  //
  // Pruning is lazy and lifecycle-agnostic: an entry is dropped only once
  // its light is no longer attached to any THREE.Scene at all (its root
  // has no .parent and isn't itself a Scene), which is what a real despawn
  // (parent.remove(light)) leaves behind. A light whose root is some
  // *other* still-alive scene is kept — areas each keep their own
  // persistent scene and swap which one is "active" rather than rebuilding
  // on transition, so a light temporarily in an inactive one must not be
  // dropped just because it isn't the scene being asked about right now.
  const lights = [];

  function register(light) {
    if (light?.isPointLight) lights.push(light);
    return light;
  }

  function list(activeScene) {
    let writeIdx = 0;
    const alive = [];
    for (let i = 0; i < lights.length; i++) {
      const light = lights[i];
      let root = light;
      while (root.parent) root = root.parent;
      if (!root.isScene) continue; // Despawned -- drop from the registry for good.
      lights[writeIdx++] = light;
      if (root === activeScene && light.userData?.furnitureLightMask) alive.push(light);
    }
    lights.length = writeIdx;
    return alive;
  }

  window.FurnitureLightRegistry = { register, list };
})();
