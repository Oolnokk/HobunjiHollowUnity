// Hat overflow plane: shows the part of a worn hat that falls outside the
// 200x200 portrait square without making the portrait itself any bigger.
//
// The world avatar's portrait texture (and everything measured from it:
// portraitModelWidth/Height, hitboxes, hand/foot anchors, grounding, head
// detection) stays exactly as it was. Separately, the hat's own layers are
// rendered once more into a canvas padded by PAD logical px on every side at
// the same scale (renderProfile's hatOverflowPad option), the area the
// portrait already covers is cleared, and whatever is left -- brim tips,
// tall crowns -- goes on an extra front/back plane pair that sits exactly over
// the portrait plane. On neck-rigged avatars that pair hangs off the head-scale
// bone, so it turns and scales with the head; on rigid assemblies it is a
// sibling of the portrait meshes.
//
// The extra plane is invisible to anything that measures the avatar: empty
// geometry bounds (Box3.setFromObject ignores it), no raycast, no frustum
// culling, no generated outline (visual-authoring.md: PNG planes own their
// ink). Nothing is created when the hat fits inside the square.
(function () {
  'use strict';
  if (window.HatOverflowPlane) return;

  const PAD = 64; // Logical portrait px of headroom on each side (portrait square is 200).
  const ALPHA_MIN = 8; // Pixels fainter than this do not count as overflow.
  const INSET = 3; // Overflow keeps a band inside the square that covers the portrait texture's soft edge column.
  const SEAM_ALPHA_TEST = 0.9;
  const FACE_OFFSET = 0.0005; // Overflow sits this far in front of its portrait face, so that band wins the depth test.
  const stats = { checked: 0, attached: 0, empty: 0, failed: 0, cacheHits: 0, cacheMisses: 0 };
  const overflowCache = new Map(); // Immutable bake canvases (including null), never GPU resources.
  const imageIds = new WeakMap(); // Distinguishes replaced authored image objects without retaining them.
  let nextImageId = 0, cacheBytes = 0; // Bounded CPU memory accounting.
  const CACHE_BYTES = 4 * 1024 * 1024, CACHE_ENTRIES = 32;
  function keyForLayers(layers, width, height, logical) {
    return JSON.stringify([width,height,logical.width,logical.height,layers.map(({image,url,xform,tint})=>{
      if(!imageIds.has(image))imageIds.set(image,++nextImageId);
      return [imageIds.get(image),image.currentSrc||image.src,url,image.naturalWidth,image.naturalHeight,xform,tint];
    })]);
  }
  function rememberBake(key,canvas) {
    if(overflowCache.has(key))return;
    const bytes=canvas?canvas.width*canvas.height*4:0;
    if(bytes>CACHE_BYTES)return;
    while(overflowCache.size>=CACHE_ENTRIES||cacheBytes+bytes>CACHE_BYTES){
      const oldest=overflowCache.keys().next().value;
      cacheBytes-=overflowCache.get(oldest).bytes;overflowCache.delete(oldest);
    }
    overflowCache.set(key,{canvas,bytes});cacheBytes+=bytes;
  }

  function hasHat(profile) {
    const hat = profile?.hat;
    return !!(hat && hat.id && hat.id !== 'none' && (hat.layers?.length || hat.url || hat.variants));
  }

  function logicalSize() {
    const size = window.getPortraitCanvasLogicalSize?.();
    return { width: size?.width || 200, height: size?.height || 200 };
  }

  // Renders the hat alone into a padded canvas whose scale matches a portrait
  // canvas of sourceWidth x sourceHeight px, clears the portrait square and
  // returns the canvas, or null when no hat pixel lies outside the square.
  async function renderOverflowCanvas(profile, view, sourceWidth, sourceHeight, renderer = window.renderPortraitProfile, useCache = false) {
    if (typeof renderer !== 'function' || !hasHat(profile)) return null;
    const logical = logicalSize();
    const scaleX = sourceWidth / logical.width, scaleY = sourceHeight / logical.height;
    const padX = Math.round(PAD * scaleX), padY = Math.round(PAD * scaleY);
    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth + 2 * padX;
    canvas.height = sourceHeight + 2 * padY;
    let key=null, hit=null; // Only the canonical resolved-layer renderer may authorize reuse.
    const reuseHatOverflow = useCache && renderer===window.renderPortraitProfile ? layers=>{
      try{key=keyForLayers(layers,sourceWidth,sourceHeight,logical);}catch(_){return false;} // Cache metadata must never prevent a normal render.
      if(!overflowCache.has(key)){stats.cacheMisses++;return false;}
      hit=overflowCache.get(key);overflowCache.delete(key);overflowCache.set(key,hit);
      stats.cacheHits++;return true;
    } : undefined;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    await renderer(canvas, profile, { hatOverflowPad: PAD, forceEyesOpen: true, portraitView: view, seatId: 'hat-overflow', reuseHatOverflow });
    if(hit)return hit.canvas;
    ctx.clearRect(padX + INSET, padY + INSET, sourceWidth - 2 * INSET, sourceHeight - 2 * INSET);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // Only pixels strictly outside the square count; the seam band alone is not overflow.
    for (let y = 0; y < canvas.height; y++) {
      const insideRow = y >= padY && y < padY + sourceHeight;
      for (let x = 0; x < canvas.width; x++) {
        if (insideRow && x >= padX && x < padX + sourceWidth) { x = padX + sourceWidth - 1; continue; }
        if (data[(y * canvas.width + x) * 4 + 3] >= ALPHA_MIN) { if(key!==null)rememberBake(key,canvas);return canvas; }
      }
    }
    if(key!==null)rememberBake(key,null);
    return null;
  }

  const emptyRaycast = function () {};

  function markOverflowMesh(THREE, mesh) {
    mesh.userData.noOutline = true; // The hat PNG owns its silhouette ink.
    mesh.userData.hatOverflowPlane = true;
    mesh.userData.excludeFromAvatarBounds = true;
    mesh.frustumCulled = false;
    mesh.raycast = emptyRaycast; // Never a hit target; picking keeps using the portrait plane.
    mesh.geometry.boundingBox = new THREE.Box3(); // Empty: Box3.setFromObject / bounds measurements skip it.
    mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
    mesh.renderOrder = 3; // After the portrait plane (renderOrder 2).
    // The cleared centre is transparent black; linear filtering blends that black
    // into the band's inner edge. A high cutoff discards those blended fragments
    // (the portrait plane shows there), so no dark seam line is drawn.
    mesh.material.alphaTest = Math.max(mesh.material.alphaTest || 0, SEAM_ALPHA_TEST);
    mesh.material.needsUpdate = true;
    return mesh;
  }

  // Transfer mesh resources only after all factories succeed.
  function makeOverflowMesh(THREE,canvas,behind,width,height) {
    const api=window.PNGPlaneAvatar,face=behind?'back':'front';
    let texture=null,geometry=null,material=null; // Owned locally until mesh construction succeeds.
    try{
      texture=api.makePortraitTexture(THREE,api.makeVariantCanvas(canvas,behind?{flipX:true}:{}),`hat_overflow_${face}_texture`,face);
      geometry=new THREE.PlaneGeometry(width,height);
      material=api.makeSpriteMaterial(THREE,texture,`hat_overflow_${face}_material`);
      const mesh=markOverflowMesh(THREE,new THREE.Mesh(geometry,material));
      mesh.name=`hat_overflow_${face}_plane`;return mesh;
    }catch(error){geometry?.dispose?.();material?.dispose?.();texture?.dispose?.();throw error;}
  }

  // Builds the front/back overflow meshes. widthScale/heightScale are the
  // padded canvas size relative to the portrait canvas; the planes share the
  // portrait plane's centre because the padding is symmetric.
  function buildOverflowGroup(THREE, root, front, back, mirrorBackX) {
    const src = root.userData.sourceCanvas;
    const modelWidth = root.userData.portraitModelWidth, modelHeight = root.userData.portraitModelHeight;
    const group = new THREE.Group();
    group.name = 'hat_overflow_planes';
    group.userData.hatOverflowPlane = true;
    const planeFor=(canvas,behind)=>makeOverflowMesh(THREE,canvas,behind,modelWidth*canvas.width/src.width,modelHeight*canvas.height/src.height);
    try{
      if(front){const mesh=planeFor(front,false);group.add(mesh);mesh.position.z=FACE_OFFSET;}
      if(back){const mesh=planeFor(back,true);group.add(mesh);mesh.position.z=-FACE_OFFSET;mesh.rotation.y=Math.PI;if(mirrorBackX)mesh.scale.x=-1;}
      return group.children.length?group:null;
    }catch(error){disposeOverflow(group);throw error;}
  }

  // Places the overflow group under the head-scale bone at the bone's bind
  // (rest) offset, so at rest it lands exactly on the portrait plane.
  function attachToSkinnedHead(rig, group) {
    const plane = rig.skinnedPlane, bone = rig.headScaleJoint;
    const skeleton = plane?.skeleton;
    const index = skeleton?.bones?.indexOf(bone) ?? -1;
    if (index < 0 || !skeleton.boneInverses?.[index]) return false;
    const rest = skeleton.boneInverses[index].clone().multiply(plane.bindMatrix);
    rest.decompose(group.position, group.quaternion, group.scale);
    bone.add(group);
    return true;
  }

  function attachToRigidAssembly(root, group) {
    const assembly = root.userData.portraitAssembly;
    if (!assembly) return false;
    const frontMesh = assembly.children.find(child => child.isMesh);
    group.position.z = frontMesh ? frontMesh.position.z : 0;
    assembly.add(group);
    return true;
  }

  function disposeOverflow(group) {
    if(!group)return;
    group.parent?.remove(group);
    group.traverse(child => {
      child.geometry?.dispose?.();
      if (child.material) { child.material.map?.dispose?.(); child.material.dispose?.(); }
    });
  }
  function removeOverflow(root) {
    if(!root?.userData)return;
    root.userData.hatOverflowToken=(root.userData.hatOverflowToken||0)+1; // Also cancel a pending bake.
    disposeOverflow(root.userData.hatOverflowGroup);
    root.userData.hatOverflowGroup = null;
  }

  // Renders and attaches the overflow planes for a freshly built avatar.
  // Resolves to the attached group, or null when the hat fits / no hat.
  async function attach(THREE, root, options = {}) {
    const profile = options.profile;
    if (!THREE || !root) return null;
    if(!hasHat(profile)){removeOverflow(root);return null;}
    const src = root.userData?.sourceCanvas;
    if (!src?.width || !src?.height) return null;
    const token = (root.userData.hatOverflowToken || 0) + 1;
    root.userData.hatOverflowToken = token;
    stats.checked++;
    let group=null; // Owns resources until attachment succeeds.
    try {
      const [front, back] = await Promise.all([
        renderOverflowCanvas(profile, 'front', src.width, src.height, undefined, true),
        options.backCanvas ? renderOverflowCanvas(profile, 'behind', src.width, src.height, undefined, true) : Promise.resolve(null),
      ]);
      if (root.userData.hatOverflowToken !== token || root.userData.portraitDisposed) return null; // Superseded or the avatar was disposed meanwhile.
      if (!front && !back) { removeOverflow(root);stats.empty++; return null; }
      const rig = root.userData.neckRig;
      const skinned = !!(rig?.available && rig.headScaleJoint && rig.skinnedPlane);
      group = buildOverflowGroup(THREE, root, front, back, skinned);
      if (!group) { stats.empty++; return null; }
      removeOverflow(root);
      if (!(skinned ? attachToSkinnedHead(rig, group) : attachToRigidAssembly(root, group))) { disposeOverflow(group);stats.failed++; return null; }
      root.userData.hatOverflowGroup = group;
      stats.attached++;
      return group;
    } catch (error) {
      if(group!==root.userData.hatOverflowGroup)disposeOverflow(group);
      stats.failed++;
      console.warn('[hat-overflow] skipped', error);
      return null;
    }
  }

  // Per-plane variant for avatars that take the portrait's front and back
  // meshes apart (bandit/enemy portraits re-parent each onto its own pivot,
  // where each faces its pivot's +Z). planes: [{ view: 'front' | 'behind',
  // mesh, headBone? }]. The overflow mesh goes on the plane's head bone at its
  // rest offset when the plane was neck-skinned, else beside the mesh.
  async function attachToPlanes(THREE, options = {}) {
    const { profile, sourceCanvas: src, modelWidth, modelHeight } = options;
    const planes = (options.planes || []).filter(plane => plane?.mesh);
    if (!THREE || !planes.length || !hasHat(profile) || !src?.width || !src?.height || !(modelWidth > 0) || !(modelHeight > 0)) return [];
    stats.checked++;
    const attached=[]; // Roll back all holders if the split-plane build fails.
    try {
      const canvases = await Promise.all(planes.map(plane => renderOverflowCanvas(profile, plane.view === 'behind' ? 'behind' : 'front', src.width, src.height, undefined, true)));
      if (options.isCancelled?.()) return [];
      planes.forEach((plane, index) => {
        const canvas = canvases[index];
        if (!canvas || !plane.mesh.parent || options.isCancelled?.()) return;
        const behind = plane.view === 'behind';
        // Size from the plane actually drawn (its geometry), falling back to the portrait size.
        const geometry = plane.mesh.geometry;
        if (geometry && !geometry.boundingBox) geometry.computeBoundingBox?.();
        const box = geometry?.boundingBox;
        const planeW = box && box.max.x > box.min.x ? box.max.x - box.min.x : modelWidth;
        const planeH = box && box.max.y > box.min.y ? box.max.y - box.min.y : modelHeight;
        const holder = new THREE.Group(); // Track ownership before fallible mesh/attachment work.
        holder.name = 'hat_overflow_planes';
        holder.userData.hatOverflowPlane = true;
        attached.push(holder);
        const mesh=makeOverflowMesh(THREE,canvas,behind,planeW*canvas.width/src.width,planeH*canvas.height/src.height);
        holder.add(mesh);mesh.position.z=FACE_OFFSET;
        const target = plane.mesh, bone = plane.headBone;
        const skeleton = target.isSkinnedMesh ? target.skeleton : null;
        const boneIndex = bone && skeleton ? skeleton.bones.indexOf(bone) : -1;
        if (boneIndex >= 0 && skeleton.boneInverses?.[boneIndex]) {
          // Same rest offset as attachToSkinnedHead: a skinned vertex lands at
          // boneWorld * boneInverse * bindMatrix * geometryPoint.
          const rest = skeleton.boneInverses[boneIndex].clone().multiply(target.bindMatrix);
          rest.decompose(holder.position, holder.quaternion, holder.scale);
          bone.add(holder);
        } else if (target.parent) {
          holder.position.copy(target.position); holder.quaternion.copy(target.quaternion); holder.scale.copy(target.scale);
          target.parent.add(holder);
        } else { disposeOverflow(holder);attached.pop();return; }
      });
      if (attached.length) stats.attached++; else stats.empty++;
      return attached;
    } catch (error) {
      for(const holder of attached)disposeOverflow(holder);
      stats.failed++;
      console.warn('[hat-overflow] skipped', error);
      return [];
    }
  }

  window.HatOverflowPlane = Object.freeze({
    PAD, ALPHA_MIN, INSET, hasHat, renderOverflowCanvas, attach, attachToPlanes, remove: removeOverflow,
    stats: () => ({ ...stats, cacheEntries:overflowCache.size, cacheBytes }),
  });
})();
