// Cavern entrance daylight: a warm point light plus a lighter floor patch at
// a den cavern's mouth, so the way out reads as "the way out" and the
// player's spawn point is not pitch dark. Moved out of game.js's interior
// scene builder; game.js calls CavernEntranceLight.build() once per den build.
(() => {
  'use strict';

  // entranceTiles: Set of "col,row" keys; surfaceYAt(col, row) returns the
  // walkable floor height of that tile in the cavern being built.
  function build({ THREE, scene, entranceTiles, surfaceYAt }) {
    if (!THREE || !scene || !entranceTiles?.size) return null;
    let ex = 0, ez = 0;
    for (const key of entranceTiles) { const [c, r] = key.split(',').map(Number); ex += c; ez += r; }
    ex = ex / entranceTiles.size + 0.5; ez = ez / entranceTiles.size + 0.5;
    const doorLight = new THREE.PointLight(0xfff2d0, 1.4, 7, 2);
    doorLight.position.set(ex, 1.6, ez + 0.6);
    doorLight.userData.furnitureLightMask = true; // Local lights only reach the screen through the 2D fake-light overlay (js/furniture-light-registry.js).
    window.FurnitureLightRegistry?.register(doorLight);
    scene.add(doorLight);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xe9dcb8, transparent: true, opacity: 0.35 });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.8, 20), glowMat);
    glow.rotation.x = -Math.PI / 2;
    // y=0.02 used to sit right at the entrance's own carved floor
    // surface — not reliably ABOVE it: confirmed directly (SDF
    // field sampling, not just visual guessing) that the true
    // floor at the entrance's exact centroid only clears open air
    // somewhere between y=0.02 and y=0.05, so the glow patch was
    // landing inside the floor/rock there on every single den,
    // reading as "a little arch of light placed inside a rock,
    // cutting a hole in it" instead of lying flat on open floor.
    // 0.15 clears that transition with real margin.
    const glowTileY = surfaceYAt(Math.floor(ex), Math.floor(ez));
    glow.position.set(ex, glowTileY + 0.02, ez);
    glow.userData.hobunjiGroundSurface = true; // Floor decal: HeldObjectRenderOrder lets held weapons x-ray it like the cave floor beneath.
    scene.add(glow);
    return { light: doorLight, glow };
  }

  window.CavernEntranceLight = Object.freeze({ installed: true, build });
})();
