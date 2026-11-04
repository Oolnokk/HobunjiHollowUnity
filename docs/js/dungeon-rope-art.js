// Shared transparent rope art for traversable dungeon ropes, burden ropes, and ceiling nets.
// Geometry remains visual-only: RopeCore and the dungeon-fire mechanism keep their existing collision rules.
(() => {
  'use strict';
  const THREE = window.THREE;
  if (!THREE || window.DungeonRopeArt) return;
  const SPRITE_URL = 'assets/objectsprites/rope_long.png'; // Repo sprite used by both single-rope planes and the net atlas.
  const SPRITE_ASPECT = 152 / 2164; // PNG's original pixel aspect; preserves rope thickness as lengths change.
  const DEFAULT_LENGTH = 1; // The rope plane's unit length is scaled by updateRopePlane.
  const NET_ATLAS_SIZE = 512; // Single transparent atlas for every four-sided hanging net.
  const direction = new THREE.Vector3(); // Reused by updateRopePlane to align the plane with its physical pendulum.
  const midpoint = new THREE.Vector3(); // Reused by updateRopePlane to place the visual between anchor and bob.
  const cameraPosition = new THREE.Vector3(); // Reused to billboard along the rope axis without changing its endpoints.
  const normal = new THREE.Vector3(); // Reused to face the camera while staying perpendicular to the rope.
  const right = new THREE.Vector3(); // Reused as the billboard's horizontal basis.
  const basis = new THREE.Matrix4(); // Reused to form the camera-facing rope quaternion.
  const atlasCanvas = document.createElement('canvas'); // Used for the no-repeat rope lattice on the net frustum.
  atlasCanvas.width = atlasCanvas.height = NET_ATLAS_SIZE;
  const atlasTexture = new THREE.CanvasTexture(atlasCanvas); // Shared across all net instances; refreshed on PNG load.
  atlasTexture.wrapS = atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
  atlasTexture.encoding = THREE.sRGBEncoding;
  const spriteTexture = new THREE.TextureLoader().load(SPRITE_URL, texture => {
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.encoding = THREE.sRGBEncoding;
    drawNetAtlas(texture.image);
  }, undefined, () => console.warn('[DungeonRopeArt] Missing '+SPRITE_URL));
  spriteTexture.wrapS = spriteTexture.wrapT = THREE.ClampToEdgeWrapping;
  spriteTexture.encoding = THREE.sRGBEncoding;

  function drawNetAtlas(image) {
    const context = atlasCanvas.getContext('2d');
    if (!context || !image) return;
    const size = NET_ATLAS_SIZE;
    context.clearRect(0, 0, size, size); // Empty pixels become real gaps, not opaque painted padding.
    // Five spaced ropes down each slope, rather than repeating a texture across the surface.
    for (let index = 0; index < 5; index++) {
      const centre = (index + .5) * size / 5;
      context.drawImage(image, centre - size * .027, 0, size * .054, size);
    }
    // Three crossing cords finish the net lattice. Each uses the entire PNG once, rotated,
    // not tiled; an upside-down tapered panel will carry the crossing strands with it.
    for (const fraction of [.25, .5, .75]) {
      context.save();
      context.translate(0, size * fraction + size * .018);
      context.rotate(-Math.PI / 2);
      context.drawImage(image, 0, 0, size * .036, size);
      context.restore();
    }
    atlasTexture.needsUpdate = true;
  }

  function ropeMaterial() {
    return new THREE.MeshBasicMaterial({
      color: 0xffffff, map: spriteTexture, side: THREE.DoubleSide,
      transparent: true, alphaTest: .035, depthWrite: false, toneMapped: false,
    });
  }

  function createRopePlane(name = 'dungeon_rope_sprite') {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SPRITE_ASPECT * DEFAULT_LENGTH, DEFAULT_LENGTH), ropeMaterial());
    mesh.name = name;
    mesh.userData.dungeonRopeSprite = SPRITE_URL;
    mesh.userData.ropeAnchor = null; // Live endpoints are kept here for camera-facing redraws even when the rope is idle.
    mesh.userData.ropeBob = null; // Updated by the swing simulation; onBeforeRender uses the actual rendering camera.
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      if (!mesh.userData.ropeAnchor || !mesh.userData.ropeBob) return;
      updateRopePlane(mesh, mesh.userData.ropeAnchor, mesh.userData.ropeBob, camera);
      mesh.updateMatrixWorld(); // Three.js projects meshes before onBeforeRender, so refresh its matrix after rotation.
    };
    mesh.frustumCulled = true;
    return mesh;
  }

  function updateRopePlane(mesh, anchor, bob, camera = null) {
    if (!mesh || !anchor || !bob) return;
    mesh.userData.ropeAnchor = anchor;
    mesh.userData.ropeBob = bob;
    direction.set(bob.x-anchor.x, bob.y-anchor.y, bob.z-anchor.z);
    const length = Math.max(.001, direction.length());
    direction.divideScalar(length);
    midpoint.set((anchor.x+bob.x)*.5,(anchor.y+bob.y)*.5,(anchor.z+bob.z)*.5);
    mesh.position.copy(midpoint);
    mesh.scale.set(1, length, 1);
    if (camera?.getWorldPosition) {
      camera.getWorldPosition(cameraPosition);
      mesh.parent?.worldToLocal?.(cameraPosition); // Rope endpoints are in the parent's coordinates, not world coordinates.
    } else if (camera?.position) cameraPosition.copy(camera.position);
    else { cameraPosition.copy(midpoint); cameraPosition.z += 1; }
    normal.copy(cameraPosition).sub(midpoint);
    normal.addScaledVector(direction, -normal.dot(direction));
    if (normal.lengthSq() < .000001) normal.set(0, 0, 1).addScaledVector(direction, -direction.z);
    if (normal.lengthSq() < .000001) normal.set(1, 0, 0).addScaledVector(direction, -direction.x);
    normal.normalize();
    right.crossVectors(direction, normal).normalize();
    normal.crossVectors(right, direction).normalize();
    basis.makeBasis(right, direction, normal);
    mesh.quaternion.setFromRotationMatrix(basis);
  }

  function createNetFrustum(width = .82, depth = .68, drop = .92) {
    const bottomScale = .28; // Small payload cradle under the broad ceiling edge.
    const top = [[-width/2,0,-depth/2],[width/2,0,-depth/2],[width/2,0,depth/2],[-width/2,0,depth/2]];
    const bottom = top.map(point => [point[0]*bottomScale,-drop,point[2]*bottomScale]);
    const positions = []; // Frustum positions: two triangles per side, no end-cap geometry.
    const uvs = []; // A complete un-tiled net atlas is mapped exactly once onto each face.
    for (let index = 0; index < 4; index++) {
      const next = (index + 1) % 4;
      const vertices = [top[index],bottom[index],top[next],top[next],bottom[index],bottom[next]];
      const texCoords = [[0,1],[0,0],[1,1],[1,1],[0,0],[1,0]];
      vertices.forEach((point, corner) => { positions.push(...point); uvs.push(...texCoords[corner]); });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geometry.computeVertexNormals();
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff, map: atlasTexture, transparent:true, alphaTest:.035,
      depthWrite:false, side:THREE.DoubleSide, toneMapped:false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'dungeon_fire_net_sprite_frustum';
    mesh.userData.dungeonNetAtlas = SPRITE_URL;
    return mesh;
  }

  window.DungeonRopeArt = Object.freeze({ SPRITE_URL, SPRITE_ASPECT, createRopePlane, updateRopePlane, createNetFrustum,
    debugSnapshot: () => ({ source:SPRITE_URL, spriteReady:!!spriteTexture.image, atlasNeedsUpdate:atlasTexture.needsUpdate }) });
})();