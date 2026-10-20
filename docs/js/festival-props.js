// Reusable festival dressings on ordinary editable furniture. No collision or exit changes.
(() => {
  'use strict';
  function refreshFeast() { window.FurnitureTableSystem?.refreshServices?.(); }
  function decorate(root, record) {
    const THREE = window.THREE; // Same renderer used by game and editor preview.
    const dressing = record.festivalDecoration || (record.key === 'festivalArch' ? 'road-arch' : null); // Registered festivalArch furniture renders its overhead PNG arch even without a separate event dressing override.
    if (!THREE || (!dressing && !record.activity)) return;
    const group = new THREE.Group(); // Owned by the prop; rebuilding/disposal follows its normal lifecycle.
    group.name = 'festival-dressing';
    const color = record.festivalColor || '#caa45c'; // Authored accent, editable without changing shared furniture definitions.
    const material = new THREE.MeshLambertMaterial({ color }); // These are solid 3D placeholder objects, not PNG surfaces.
    const wood = new THREE.MeshLambertMaterial({ color: '#906344' });
    group.userData.festivalMaterials = [material, wood]; // Only these materials belong to this dressing; furniture materials may be shared.
    function box(x, y, z, w, h, d, mat = material) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); // Small geometry per ornament, created only when a layout is built.
      mesh.position.set(x, y, z); group.add(mesh); return mesh;
    }
    // PNG-backed arch materials are shared across placements; the arch is a
    // walk-through ornament with no invisible posts/colliders across the road.
    const atlas = window.FestivalProps?._atlas || {}; // Reuses loaded textile/wood textures over the full town.
    if (['road-arch','bandstand','dancefloor'].includes(dressing) && root.isGroup) {
      for (const existingChild of root.children) existingChild.visible = false; // Suppresses the reusable furniture proxy (rug) beneath our authored walk-through mesh.
    }
    if (dressing === 'road-arch') {
      const width = Math.max(2, Math.min(9, Number(record.festivalArchWidth) || 4)); // The authored clear span over the road.
      const woodSurface = atlas.wood ? new THREE.MeshLambertMaterial({ map: atlas.wood, color: '#ffffff' }) : wood;
      const flagsSurface = atlas.flags ? new THREE.MeshLambertMaterial({ map: atlas.flags, transparent: true, alphaTest: .1, side: THREE.DoubleSide }) : material;
      if (woodSurface !== wood) group.userData.festivalMaterials.push(woodSurface);
      if (flagsSurface !== material) group.userData.festivalMaterials.push(flagsSurface);
      const beam = (x1,y1,x2,y2, thickness, mat) => {
        const length = Math.hypot(x2-x1,y2-y1);
        const piece=box((x1+x2)/2,(y1+y2)/2,0,length,thickness,.09,mat);
        piece.rotation.z=Math.atan2(y2-y1,x2-x1);
      }; // Used to build the curved lintel without a flat impostor spanning the roadway.
      const archY = x => 2.15 + .42*(1-Math.pow(2*x/width,2));
      for (const side of [-1,1]) box(side*width/2,1.08,0,.16,2.16,.16,woodSurface);
      for (let i=0;i<16;i++) {
        const a=-width/2+i*width/16,b=a+width/16;
        beam(a,archY(a),b,archY(b),.13,woodSurface);
      }
      for (let i=0;i<Math.max(6,Math.round(width*3));i++) {
        const x=-width/2+.22+(i+.5)*(width-.44)/Math.max(6,Math.round(width*3));
        const flag=new THREE.Mesh(new THREE.PlaneGeometry(.24,.38),flagsSurface);
        flag.position.set(x,archY(x)-.23,.08);group.add(flag);
      }
    } else if (dressing === 'bandstand') {
      const planks = atlas.wood ? new THREE.MeshLambertMaterial({map:atlas.wood,color:'#ffffff'}) : wood;
      if (planks!==wood) group.userData.festivalMaterials.push(planks);
      // The platform is ordinary shortened/stretched table furniture in the locale; only rail/post dressing lives here.
      for(const x of [-1.7,1.7])for(const z of [-1,1])box(x,.72,z,.11,.9,.11,planks);
      for(const x of [-1.2,0,1.2])box(x,.08,1.43,.9,.16,.42,planks);
      box(0,.88,-1.02,3.55,.17,.12,planks);
    } else if (dressing === 'dancefloor') {
      const border=atlas.wood ? new THREE.MeshLambertMaterial({map:atlas.wood,color:'#e0b984'}) : wood;
      if(border!==wood)group.userData.festivalMaterials.push(border);
      box(0,.021,0,4.82,.04,3.82,border); // Real full-footprint dance surface, not a stretched rug.
      for (const x of [-2.45,2.45])box(x,.045,0,.12,.08,3.8,border);
      for (const z of [-1.95,1.95])box(0,.045,z,4.8,.08,.12,border);
      for(let i=-2;i<=2;i++)for(let j=-1;j<=1;j++)box(i*.87,.018,j*.9,.035,.025,.75,material);
    } else if (dressing === 'gifts') {
      for (let i = 0; i < 3; i++) { const x = (i - 1) * .28; box(x, .82, 0, .22, .23, .22); box(x, .95, 0, .25, .035, .055, wood); }
    } else if (dressing === 'ancestors') {
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * .16; // Five little carved ancestors on the shrine table.
        box(x, .83, 0, .08, .19, .07, wood);
        const head = new THREE.Mesh(new THREE.SphereGeometry(.055, 5, 4), wood);
        head.position.set(x, .965, 0); group.add(head);
      }
    } else if (dressing === 'blossoms') {
      for (let i = 0; i < 5; i++) {
        const angle = i * Math.PI * 2 / 5; // Five petals make the placeholder recognizable from a distance.
        const petal = new THREE.Mesh(new THREE.SphereGeometry(.13, 6, 4), material);
        petal.scale.y = .4; petal.position.set(Math.cos(angle) * .2, .81, Math.sin(angle) * .2); group.add(petal);
      }
      box(0, .7, 0, .12, .2, .12, wood);
    } else if (dressing === 'feast' || dressing === 'sweets') {
      for (let i = 0; i < 3; i++) {
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(.12, .08, .1, 8), material);
        bowl.position.set((i - 1) * .26, .79, 0); group.add(bowl);
      }
    } else if (dressing === 'masks') {
      for (let i = 0; i < 3; i++) { const x = (i - 1) * .27; box(x, .83, 0, .2, .22, .07); box(x - .07, .97, 0, .06, .1, .06); box(x + .07, .97, 0, .06, .1, .06); }
    } else if (dressing === 'bunting') {
      box(-.36, .8, 0, .04, 1.6, .04, wood); box(.36, .8, 0, .04, 1.6, .04, wood); box(0, 1.55, 0, .76, .025, .025, wood);
      for (let i = 0; i < 5; i++) {
        const flag = new THREE.Mesh(new THREE.ConeGeometry(.075, .2, 3), material);
        flag.rotation.z = Math.PI; flag.position.set((i - 2) * .15, 1.42, 0); group.add(flag);
      }
    }
    if (record.activity && record.showActivitySign !== false && !['road-arch', 'bandstand', 'dancefloor', 'six-pot-feast'].includes(dressing) && window.HobunjiSpritePngSurface) {
      const canvas = document.createElement('canvas'); // Text is generated locally, so no external texture/CORS request is needed.
      canvas.width = 512; canvas.height = 96;
      const context = canvas.getContext('2d');
      context.fillStyle = '#17241fed'; context.fillRect(0, 0, 512, 96);
      context.strokeStyle = color; context.lineWidth = 6; context.strokeRect(3, 3, 506, 90);
      context.fillStyle = '#fff5dc'; context.font = 'bold 28px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(record.activity.label || window.FestivalCalendar?.activityLabels[record.activity.type] || record.activity.type, 256, 48, 480);
      const texture = window.HobunjiSpritePngSurface.makeCanvasTexture(THREE, canvas, 'festival-sign');
      const surface = window.HobunjiSpritePngSurface.makeMaterial(THREE, texture, 'festival-sign', { side: THREE.DoubleSide });
      group.userData.festivalMaterials.push(surface);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, .34), surface);
      sign.position.set(0, 1.45, .06);
      const parentRotation = new THREE.Quaternion(); // Reused at render time to keep the sign readable despite authored prop rotation.
      sign.onBeforeRender = (_renderer, _scene, camera) => { group.getWorldQuaternion(parentRotation); sign.quaternion.copy(parentRotation.invert()).multiply(camera.quaternion); };
      group.add(sign);
      group.userData.festivalTexture = texture;
    }
    root.add(group);
  }
  function dispose(root) {
    root?.traverse?.(object => {
      if (!object.userData?.festivalMaterials) return;
      for (const material of object.userData.festivalMaterials) material.dispose();
      object.userData.festivalMaterials = null;
      object.userData.festivalTexture?.dispose();
      object.userData.festivalTexture = null;
    });
  }
  const atlas = {}; // Shared PNG texture atlas, used for arches, stage boards, and dance-floor borders.
  function loadAtlas() {
    if (!window.THREE?.TextureLoader) return;
    const loader = new window.THREE.TextureLoader();
    const scriptUrl = typeof document !== 'undefined' ? document.currentScript?.src : null; // Keeps textures relative to docs when loaded by nested editors.
    for (const name of ['wood','flags']) {
      const asset = 'assets/furniture/festival-' + name + '.png'; // Shared atlas path for game and editor loads.
      atlas[name] = loader.load(scriptUrl ? new URL('../' + asset, scriptUrl).href : asset, texture => {
        texture.wrapS = texture.wrapT = window.THREE.RepeatWrapping;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
      }, undefined, () => window.__farmLog?.('[festival] PNG texture unavailable: ' + name, 'warn')); // Immediate texture object makes first-scene arches textured when the PNG loads.
    }
  }
  loadAtlas();
  window.FestivalProps = { decorate, dispose, refreshFeast, _atlas: atlas };
})();
