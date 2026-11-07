// Shared carved-stone, Tankan-lettered pressure plates for Puzzle Cave songs.
(() => {
  'use strict';
  if (window.PuzzleCavePlateArt?.installed) return;

  const INSCRIPTION = "hao'uun"; // Both exterior and interior melody plates carry the same authored Tankan word.
  let texturePromise = null; // A single async Tankan canvas texture serves every cave plate without duplicate font/texture uploads.

  function tankanTexture(THREE) {
    if (texturePromise) return texturePromise;
    texturePromise = Promise.resolve(window.FurnitureDecalRuntime?.ensureTankanLayout?.() || window.TankanScriptLayout)
      .then(async layout => {
        if (!layout?.ensureFontLoaded || !layout?.createCanvas) throw new Error('Tankan furniture lettering system is unavailable');
        await layout.ensureFontLoaded(); // Never substitute a fallback alphabet while the Tankan font is loading.
        const result = layout.createCanvas(INSCRIPTION, {
          fontSizePx: 128, columnSpacingEm: -0.35, glyphAdvanceEm: 0.6,
          glyphScaleX: 1.2, glyphScaleY: 0.84,
          paddingXEm: 0.8, paddingYEm: 0.28, color: '#dfbf83',
        }); // Furniture Editor's shared column layout and rotated/flipped Tankan font, rather than hand-built glyphs.
        if (!result?.canvas) throw new Error('Tankan script rasterizer returned no canvas');
        const texture = new THREE.CanvasTexture(result.canvas);
        if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
        else if (THREE.sRGBEncoding != null) texture.encoding = THREE.sRGBEncoding;
        texture.needsUpdate = true;
        return texture;
      }).catch(error => {
        texturePromise = null; // A later cave can retry after a temporary font or loader failure.
        throw error;
      });
    return texturePromise;
  }

  function decorate(THREE, plate, {radius = 1, thickness = .15, toward = {x:0,z:1}} = {}) {
    if (!THREE?.Mesh || !THREE?.PlaneGeometry || !plate?.add) return null;
    const part = { color:'#8a8171', materialRole:'stone', materialTexture:'carved_smooth.png',
      materialLighting:'unlit', materialFillMode:'never' };
    const stone = window.ProceduralFurniture?.makePartMaterial?.(part)
      || new THREE.MeshBasicMaterial({color:0x8a8171});
    plate.material = stone; // The actual plate uses the Furniture Author's carved_smooth texture/material pipeline.
    plate.userData ||= {};
    plate.userData.puzzleCavePlateTexture = 'carved_smooth.png'; // Mobile scene inspection can distinguish the authored finish.
    plate.userData.puzzleCaveTankanText = INSCRIPTION;

    const width = radius * .76, height = radius * 1.35; // Fit the entire vertical word inside the circular plate, including its corners.
    const glyph = new THREE.Mesh(new THREE.PlaneGeometry(width,height),
      new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,depthWrite:false,side:THREE.DoubleSide}));
    glyph.name='puzzle-cave-tankan-hao-uun';
    const towardX=Number(toward?.x),towardZ=Number(toward?.z); // Signed vector from plate to locked door; zero must remain zero for east/west cave approaches.
    const heading=Math.atan2(Number.isFinite(towardX)?towardX:0,
      Number.isFinite(towardZ)?towardZ:1); // Tangent and diagonal doors now face correctly instead of accidentally adding Z=1.
    glyph.rotation.order='YXZ'; // Compose the world-facing yaw before the top-facing tilt, preserving the upward decal normal.
    glyph.rotation.x=-Math.PI/2;
    glyph.rotation.y=heading;
    glyph.rotation.z=Math.PI; // Local text top points toward the door, not upside down toward the player.
    glyph.position.y=thickness/2+.012; // Rest just above the actual stone top; never z-fight or block movement.
    glyph.visible=false; // Do not show an untextured rectangle while the font loads.
    glyph.raycast=()=>{};
    plate.add(glyph);
    let disposed=false; // Async font completion must not resurrect decals on a retired cave scene.
    tankanTexture(THREE).then(texture => {
      if (disposed) return;
      glyph.material.map=texture;
      glyph.material.needsUpdate=true;
      glyph.visible=true;
      plate.userData.puzzleCaveTankanReady=true;
    }).catch(error => {
      if (disposed) return;
      plate.userData.puzzleCaveTankanError=String(error?.message||error); // Mobile-visible failure rather than silent Latin fallback.
      window.__farmLog?.('[puzzle-cave] Tankan pressure-plate inscription: '+plate.userData.puzzleCaveTankanError,'warn');
    });

    return {
      dispose() {
        if (disposed) return;
        disposed=true;
        glyph.parent?.remove(glyph);
        glyph.geometry?.dispose?.();
        glyph.material?.dispose?.(); // CanvasTexture belongs to the shared cache, not any single plate.
      }
    };
  }

  window.PuzzleCavePlateArt = Object.freeze({installed:true,INSCRIPTION,decorate});
})();
