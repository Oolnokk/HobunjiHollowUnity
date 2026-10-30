// Reusable layered PNG weapons and flexible chain/head assemblies.
// The existing held-tool plane remains the pose, hand-grip and hit authority.
// Optional spriteLayers are static overlays; an optional flail adds a hanging,
// independently oriented chain and a layered head. Nothing here changes combat.
(function (global) {
  'use strict';
  if (global.HobunjiWeaponSpriteAssemblies) return;

  const scriptUrl = document.currentScript?.src || new URL('js/weapon-sprite-assemblies.js', location.href).href; // Resolves shared art from either gameplay or the attack editor.
  const images = new Map(); // Loaded source textures; each visible mesh clones the texture so editor disposal never damages the cache.
  const records = new Set(); // Active or recently detached assemblies, updated at the pre-render checkpoint.
  const states = new WeakMap(); // One attachment state per held visual; no global weapon pose is shared between actors.
  const alphaBounds = new WeakMap(); // Transparent-pixel anchor scans are cached by the loaded image.
  const PIXEL_ALPHA = 128; // Treat only the solid half of an antialiased edge as the opaque connection tip.
  const MAX_DT = 0.08; // Prevent tab-resume and loading stalls from launching the head sideways.
  const MOTION_LAG = 0.065; // Converts haft travel velocity to idle trailing angle.
  const DETACHED_TIMEOUT = 5000; // Remove orphaned assemblies without deleting reusable inventory meshes immediately.
  const DEF = global.WEAPON_SPRITE_ASSEMBLY_CONFIG?.weapons || {}; // Single committed recipe registry shared with the Tool Hub; tool-specific definitions may still override it.
  const effects = global.HobunjiLayeredWeaponEffects; // Materials, interleaved fire, and visible-metal source masks live outside the animation module.


  function report(message) {
    global.__farmLog?.('[weapon assembly] ' + message, 'warn');
    if (/attack-animation-editor/.test(location.pathname || '')) global.console?.warn?.('[weapon assembly] ' + message);
  }

  function imageUrl(path) {
    if (/^(?:data:|blob:|https?:)/i.test(String(path || ''))) return path;
    return new URL('../' + String(path || '').replace(/^\/+/, ''), scriptUrl).href;
  }

  function textureFor(THREE, path) {
    const url = imageUrl(path);
    if (!images.has(url)) {
      images.set(url, new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(url, tex => {
          const surface = global.HobunjiSpritePngSurface || global.HobunjiPngPlaneUnlit;
          if (surface?.configureTexture) surface.configureTexture(THREE, tex, url); // Shared authored PNG color-management and filtering policy.
          else tex.magFilter = tex.minFilter = THREE.NearestFilter;
          resolve(tex);
        }, undefined, reject);
      }));
    }
    return images.get(url);
  }

  function opaqueAt(image, edge) {
    if (!image) return null;
    let cache = alphaBounds.get(image);
    if (!cache) {
      cache = {};
      alphaBounds.set(image, cache);
    }
    if (cache[edge]) return cache[edge];
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    if (!(width > 0 && height > 0)) return null;
    const fallback = { x: (width - 1) / 2, y: edge === 'top' ? 0 : height - 1 };
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const rgba = ctx.getImageData(0, 0, width, height).data;
      for (let n = 0; n < height; n++) {
        const y = edge === 'top' ? n : height - n - 1;
        let xTotal = 0, count = 0;
        for (let x = 0; x < width; x++) {
          if (rgba[(y * width + x) * 4 + 3] >= PIXEL_ALPHA) { xTotal += x; count++; }
        }
        if (count) return (cache[edge] = { x: xTotal / count, y });
      }
    } catch (error) { report('PNG pixel scan unavailable: ' + (error?.message || error)); }
    return (cache[edge] = fallback);
  }

  function anchor(image, spec, fallbackEdge) {
    const width = image?.naturalWidth || image?.width || 0;
    const height = image?.naturalHeight || image?.height || 0;
    if (Number.isFinite(spec?.x) && Number.isFinite(spec?.y)) {
      return { x: Math.max(0, Math.min(width - 1, spec.x)), y: Math.max(0, Math.min(height - 1, spec.y)) };
    }
    return opaqueAt(image, spec?.opaque === 'top' || spec?.opaque === 'bottom' ? spec.opaque : fallbackEdge);
  }

  function pixelPoint(image, point, unit, offset, out) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    return out.set(
      (point.x + 0.5 - width / 2 + (Number(offset?.x) || 0)) * unit,
      (height / 2 - point.y - 0.5 - (Number(offset?.y) || 0)) * unit,
      0,
    );
  }

  function planeQuaternion(worldUp, preferredNormal, result, scratch) {
    const up = scratch.up.copy(worldUp).normalize();
    const normal = scratch.orientedNormal.copy(preferredNormal).addScaledVector(up, -preferredNormal.dot(up));
    if (normal.lengthSq() < 1e-5) normal.set(0, 0, 1).addScaledVector(up, -up.z);
    if (normal.lengthSq() < 1e-5) normal.set(1, 0, 0).addScaledVector(up, -up.x);
    normal.normalize();
    const right = scratch.right.crossVectors(up, normal).normalize();
    normal.crossVectors(right, up).normalize();
    return result.setFromRotationMatrix(scratch.basis.makeBasis(right, up, normal));
  }

  function buildPlane(THREE, image, tex, unit, order, offset = null) {
    const w = image.naturalWidth || image.width || 1;
    const h = image.naturalHeight || image.height || 1;
    const geometry = new THREE.PlaneGeometry(w * unit, h * unit);
    const map = tex.clone(); // Per-mesh map ownership keeps editor teardown safe.
    map.needsUpdate = true;
    const surface = global.HobunjiSpritePngSurface || global.HobunjiPngPlaneUnlit; // Use the same unlit PNG material pipeline as the game's other sprites.
    const material = surface?.makeMaterial
      ? surface.makeMaterial(THREE, map, 'weapon-assembly-layer', { side: THREE.DoubleSide, depthWrite: false })
      : new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.08, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((Number(offset?.x) || 0) * unit, -(Number(offset?.y) || 0) * unit, 0);
    mesh.renderOrder = order;
    mesh.userData.hobunjiHeldObjectPlane = true; // Reuse the existing held-object occlusion/replay pipeline for all chain/head layers.
    mesh.userData.hobunjiWeaponAssemblyPart = true; // HeldObjectRenderOrder preserves this assembly plane's ordered overlay layer.
    return mesh;
  }

  function destroyPart(node) {
    node?.traverse?.(child => {
      if (!child.userData?.hobunjiWeaponAssemblyPart) return;
      child.geometry?.dispose?.();
      child.material?.map?.dispose?.();
      child.material?.dispose?.();
    });
    node?.parent?.remove?.(node);
  }

  function drop(root) {
    const state = states.get(root);
    if (!state) return;
    state.dead = true;
    records.delete(state);
    effects?.dispose(state); // Dispose pooled fire sprites before removing their head owner.
    for (const child of state.owned) destroyPart(child);
    states.delete(root);
  }

  function definitionFor(itemKey, def) {
    return def?.weaponAssembly || DEF[itemKey] || DEF[def?.shapeKey] || (Array.isArray(def?.spriteLayers) && def.spriteLayers.length ? { layers: def.spriteLayers } : null);
  }

  // Called at the existing tool-plane factory, so player, bandits, NPC props
  // and the Attack Editor see the same static layers and flexible attachments.
  function decorate(root, itemKey, def, options = {}) {
    const THREE = options.THREE || global.THREE;
    const config = definitionFor(itemKey, def);
    if (!root?.userData?.toolPlane || !THREE || !config) return root;
    if (states.has(root)) return root;
    const plane = root.userData.toolPlane;
    const state = {
      root, plane, itemKey, THREE, config, owned: [], headParts: [], chain: null,
      metalOptions: options.metalOptions || null, resolveAsset: imageUrl, // Uses game's live plating/mastery resolver and the same canonical asset URL for every layer.
      headRoot: null, headAnchorImage: null, chainImage: null,
      direction: new THREE.Vector3(0, -1, 0), lastPivot: new THREE.Vector3(), hasPivot: false,
      lastShaftUp: new THREE.Vector3(), hasShaftUp: false, // Tracks observed pitch travel for procedural swings lacking authored pitch values.
      strikeTurnRad: 0, wasAttacking: false, lastFrameProgress: 0, // Keeps overshoot state isolated to the current swing.
      baseAnchorImage: null, baseAnchor: null, chainTop: null, chainBottom: null, headAnchor: null,
      scratch: {
        pivotLocal: new THREE.Vector3(), pivot: new THREE.Vector3(), velocity: new THREE.Vector3(),
        normal: new THREE.Vector3(), scale: new THREE.Vector3(), rootScale: new THREE.Vector3(), target: new THREE.Vector3(), // Cached world scales measure the handle against the holder for independent chain/head ratios.
        up: new THREE.Vector3(), orientedNormal: new THREE.Vector3(), right: new THREE.Vector3(),
        axisUp: new THREE.Vector3(0, 1, 0), headUp: new THREE.Vector3(), span: new THREE.Vector3(),
        shaftUp: new THREE.Vector3(), pitchAxis: new THREE.Vector3(), pitchCross: new THREE.Vector3(), // Actual tool pitch direction and velocity for inertial hold-through.
        topLocal: new THREE.Vector3(), bottomLocal: new THREE.Vector3(), headAnchorLocal: new THREE.Vector3(),
        chainCenter: new THREE.Vector3(), endWorld: new THREE.Vector3(), headCenter: new THREE.Vector3(),
        chainLocal: new THREE.Vector3(), headLocal: new THREE.Vector3(), tmp: new THREE.Vector3(),
        baseQ: new THREE.Quaternion(), rootInverseQ: new THREE.Quaternion(),
        worldQ: new THREE.Quaternion(), headQ: new THREE.Quaternion(), correction: new THREE.Quaternion(),
        deltaQ: new THREE.Quaternion(), stepQ: new THREE.Quaternion(), basis: new THREE.Matrix4(),
      }, // Reused by every animation frame, avoiding repeated vector/quaternion/matrix allocations.
      attacking: false, progress: 0, wf: 0.16, sf: 0.28, hf: 0.68, pitchTravelRad: null, detachedAt: 0, dead: false, // Per-weapon attack timing supplied by player, enemies, or editor.
    }; // Tracks per-instance lag, asset loading and render nodes without altering the original grip.
    states.set(root, state);
    records.add(state);
    const layers = config.layers || def?.spriteLayers || []; // Committed Tool Hub recipe overrides shape defaults when both are present.
    const setup = async () => {
      const baseImg = plane.material?.map?.image;
      if (!baseImg?.width && !baseImg?.naturalWidth) return;
      const unit = (plane.geometry?.parameters?.width || 0.5) / (baseImg.naturalWidth || baseImg.width);
      const order = plane.renderOrder || 1.5;
      const staticMeshes = []; // Ordered normal-weapon overlays, used for visible-metal and interleaved VFX masks.
      for (const layer of layers) {
        const texture = await textureFor(THREE, layer.sprite);
        if (state.dead) return;
        const mesh = buildPlane(THREE, texture.image, texture, unit, order + (state.owned.length + 1) * 0.001, layer.offsetPx);
        // Static layers share the haft's exact end flip, mirrored stance and attack rotation.
        mesh.position.z = 0.001 * (state.owned.length + 1);
        plane.add(mesh);
        state.owned.push(mesh);
        staticMeshes.push(mesh);
        effects?.registerLayer(state, mesh, layer, texture.image); // Ordinary layered weapons support both recolor and author-defined material roles.
      }
      if (layers.length) {
        const rawBase = def?.sprite ? await textureFor(THREE, def.sprite) : null; // Authored metal key, never a live oxide/plating texture.
        if (state.dead) return;
        effects?.activateStatic(state, layers, staticMeshes, rawBase?.image || baseImg, unit);
      }
      if (!config.flail) return;
      const f = config.flail;
      const isRope = f.chain.type === 'rope'; // Generated suspension shares the same attachment animation as a raster chain.
      const chainTex = isRope ? null : await textureFor(THREE, f.chain.sprite);
      const ropeTexture = isRope ? await textureFor(THREE, f.chain.texture || 'assets/textures/wavy_surface.png') : null; // Same texture resource as suspended root-totem bottles.
      if (state.dead) return;
      const headTextures = await Promise.all(f.head.layers.map(layer => textureFor(THREE, layer.sprite)));
      if (state.dead) return;
      const ropePixels = Math.max(2, Math.min(2048, Number(f.chain.lengthPx) || 160));
      const chainImg = isRope ? { width: 1, height: ropePixels + 1 } : chainTex.image; // Virtual raster frame puts rope endpoints at the geometric cylinder ends.
      const chain = isRope
        ? makeRope(THREE, f.chain, unit, order + 0.01, ropeTexture)
        : buildPlane(THREE, chainImg, chainTex, unit, order + 0.01);
      if (!isRope) effects?.registerLayer(state, chain, f.chain, chainImg); // Chain shares verdigris/plating; generated natural rope keeps its authored bark-brown surface.
      const headRoot = new THREE.Group();
      headRoot.name = itemKey + '_flail_head';
      headRoot.userData.hobunjiWeaponAssemblyPart = false;
      f.head.layers.forEach((layer, i) => {
        const mesh = buildPlane(THREE, headTextures[i].image, headTextures[i], unit, order + 0.02 + i * 0.001, layer.offsetPx);
        headRoot.add(mesh);
        state.headParts.push(mesh);
        effects?.registerLayer(state, mesh, layer, headTextures[i].image); // Each head layer owns its material and may spawn effects between neighboring layers.
      });
      root.add(chain, headRoot);
      state.owned.push(chain, headRoot);
      state.chain = chain;
      state.headRoot = headRoot;
      state.headAnchorImage = headTextures[f.head.layers.findIndex(layer => layer.id === f.head.anchorLayer) >= 0
        ? f.head.layers.findIndex(layer => layer.id === f.head.anchorLayer) : 0].image;
      state.chainImage = chainImg;
      state.chainTop = isRope ? { x: 0, y: 0 } : anchor(chainImg, f.chain.top, 'top'); // For rope the top sits on the cylinder's geometric cap.
      state.chainBottom = isRope ? { x: 0, y: ropePixels } : anchor(chainImg, f.chain.bottom, 'bottom');
      state.headAnchor = f.head.anchorSpace === 'composite'
        ? { x: Number(f.head.anchor?.x) || 0, y: Number(f.head.anchor?.y) || 0 }
        : anchor(state.headAnchorImage, f.head.anchor, 'bottom'); // Composite coordinates may lie BETWEEN the two head sprites.
      effects?.activateHead(state, f.head, headTextures, unit); // Compute post-assembly visible-metal sources and fuel→front interleaved fire once.
      global.__farmLog?.('[weapon assembly] ' + itemKey + ' chain/head ready', 'info'); // Visible in the existing mobile game diagnostic log.
    };
    // The base PNG can still be loading while the equipment holder is built.
    const baseImage = plane.material?.map?.image;
    if (baseImage?.width || baseImage?.naturalWidth) setup().catch(error => report(itemKey + ': ' + error.message));
    else {
      const startAt = performance.now();
      const trySetup = () => {
        if (state.dead) return;
        if (plane.material?.map?.image?.width || plane.material?.map?.image?.naturalWidth) {
          setup().catch(error => report(itemKey + ': ' + error.message));
        } else if (performance.now() - startAt < 10000) setTimeout(trySetup, 50);
        else report(itemKey + ': base PNG did not finish loading');
      };
      trySetup();
    }
    return root;
  }

  function setAction(root, options = {}) {
    const state = states.get(root);
    if (!state) return;
    state.attacking = options.attacking === true;
    state.progress = Number.isFinite(options.progress) ? Math.max(0, Math.min(1, options.progress)) : 0;
    state.wf = Number.isFinite(options.windupFrac) ? Math.max(0, Math.min(1, options.windupFrac)) : 0.16;
    state.sf = Number.isFinite(options.strikeFrac) ? Math.max(state.wf, Math.min(1, options.strikeFrac)) : 0.28;
    state.hf = Number.isFinite(options.holdFrac) ? Math.max(state.sf, Math.min(1, options.holdFrac)) : 0.68;
    state.pitchTravelRad = Number.isFinite(options.pitchTravelDeg) ? options.pitchTravelDeg * Math.PI / 180 : null; // Authored strike-minus-windup pitch remains deterministic during editor scrubbing.
  }

  function makeRope(THREE, spec, unit, renderOrder, sourceTexture) {
    const length = Math.max(2, Math.min(2048, Number(spec.lengthPx) || 160)) * unit; // The rope length is expressed in the handle's original pixels, then inherits all handle size modifiers.
    const radius = Math.max(0.25, Math.min(30, Number(spec.radiusPx) || 2.5)) * unit; // Root-totem style generated rope cylinder, never a flat PNG chain.
    const geometry = new THREE.CylinderGeometry(radius, radius * 0.75, length, 6, 1, true);
    const ropeTexture = sourceTexture?.clone?.() || null; // Reuses the root totem's authored wavy_surface texture without sharing mutable UV repeat state.
    if (ropeTexture) {
      ropeTexture.wrapS = ropeTexture.wrapT = THREE.RepeatWrapping;
      ropeTexture.repeat.set(1, Math.max(1, length / 0.22));
      ropeTexture.needsUpdate = true;
    }
    const material = new THREE.MeshLambertMaterial({
      map: ropeTexture, color: spec.color || '#6B4728', side: THREE.FrontSide,
      transparent: false,
    }); // Matches the root totem's tapered, textured volumetric rope, rather than substituting a flat chain sprite.
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'flail_generated_rope';
    mesh.renderOrder = renderOrder;
    mesh.userData.hobunjiWeaponAssemblyPart = true;
    mesh.userData.hobunjiHeldObjectPlane = true; // Held objects obey the usual weapon occlusion handling.
    mesh.userData.hobunjiGeneratedRope = true; // Allows diagnostics and selective texture upgrades.
    mesh.userData.noOutline = false;
    return mesh;
  }

  function relativePartScale(part) {
    const n = Number(part?.scale ?? 1); // Reads the Tool Hub's chain/head scale in handle-relative units (1 = identical proportional scale).
    return Number.isFinite(n) ? Math.max(0.05, Math.min(8, n)) : 1;
  }

  function connectorAxisScale(part, axis) {
    const n = Number(part?.[axis] ?? part?.scale ?? 1); // Resolves independent connector size, falling back to legacy uniform drafts.
    return Number.isFinite(n) ? Math.max(0.05, Math.min(8, n)) : 1;
  }

  function flailPitchOvershoot(progress, strikeFrac, holdFrac, pitchTravelRad) {
    if (!(progress > strikeFrac) || !Number.isFinite(pitchTravelRad) || Math.abs(pitchTravelRad) < 0.0001) return 0;
    const sign = Math.sign(pitchTravelRad); // Continue turning in the same direction as the tool's pitch lerp.
    const maxAngle = sign * Math.min(Math.PI / 3, Math.max(0.22, Math.abs(pitchTravelRad) * 0.38)); // Scaled follow-through, bounded to 60°.
    const holdT = Math.max(0, Math.min(1, (progress - strikeFrac) / Math.max(0.0001, holdFrac - strikeFrac)));
    const returnT = Math.max(0, Math.min(1, (progress - holdFrac) / Math.max(0.0001, 1 - holdFrac)));
    const ease = t => t * t * (3 - 2 * t); // Ease into hold overshoot and back to shaft during recovery.
    return maxAngle * (progress <= holdFrac ? ease(holdT) : 1 - ease(returnT));
  }

  function updateOne(state, dt, now) {
    const { root, plane, config, scratch: q } = state;
    if (!root.parent) {
      if (!state.detachedAt) state.detachedAt = now;
      if (now - state.detachedAt > DETACHED_TIMEOUT) drop(root);
      return;
    }
    state.detachedAt = 0;
    if (!state.chain || !state.headRoot) {
      if (root.visible !== false) effects?.stepFire(state, dt); // Ordinary multi-layer tools can have interleaved VFX without a chain.
      return;
    }
    // Use the final holder+plane world pose, including the game's transient
    // authored Neutral. The rigid haft never relinquishes animation authority.
    plane.updateWorldMatrix(true, false);
    const baseImage = plane.material?.map?.image;
    if (!baseImage) return;
    const unit = (plane.geometry?.parameters?.width || 0.5) / (baseImage.naturalWidth || baseImage.width || 1);
    const flail = config.flail;
    if (state.baseAnchorImage !== baseImage) {
      state.baseAnchor = anchor(baseImage, flail.haftAnchor, 'top');
      state.baseAnchorImage = baseImage; // Re-scan only when an edited/recolored haft changes its source image.
    }
    if (!state.baseAnchor || !state.chainTop || !state.chainBottom || !state.headAnchor) return;
    const pivot = plane.localToWorld(pixelPoint(baseImage, state.baseAnchor, unit, null, q.pivotLocal));
    q.pivot.copy(pivot);
    const baseQ = plane.getWorldQuaternion(q.baseQ);
    const normal = q.normal.set(0, 0, 1).applyQuaternion(baseQ);
    plane.getWorldScale(q.scale); // The current haft's rendered world scale includes pre-existing grips, stances and item-size modifiers.
    root.getWorldScale(q.rootScale); // Both child parts live under root, not under the transformed haft plane.
    const attachmentScale = Math.max(0.00001, Math.abs(q.scale.x)); // Authoritative world-space handle pixel scale, not a fixed weapon baseline.
    const localHandleScale = attachmentScale / Math.max(0.00001, Math.abs(q.rootScale.x)); // Compensates for extra scale applied to the handle plane itself.
    const chainScaleX = connectorAxisScale(flail.chain, 'scaleX'); // Chain width or generated-rope radius relative to the final rendered handle.
    const chainScaleY = connectorAxisScale(flail.chain, 'scaleY'); // Connector length relative to the handle, independent of width.
    const headScale = relativePartScale(flail.head); // Head size is still independently handle-relative.
    state.chain.scale.set(
      localHandleScale * chainScaleX,
      localHandleScale * chainScaleY,
      localHandleScale * (state.chain.userData?.hobunjiGeneratedRope ? chainScaleX : 1),
    ); // Rope-cylinder X and Z both control thickness; Y alone controls reach.
    state.headRoot.scale.setScalar(localHandleScale * headScale);
    const topLocal = pixelPoint(state.chainImage, state.chainTop, unit, null, q.topLocal);
    const bottomLocal = pixelPoint(state.chainImage, state.chainBottom, unit, null, q.bottomLocal);
    topLocal.x *= chainScaleX; topLocal.y *= chainScaleY;
    bottomLocal.x *= chainScaleX; bottomLocal.y *= chainScaleY; // Contacts must use the same stretched coordinates as visible connector geometry.
    const chainSpan = q.span.copy(topLocal).sub(bottomLocal);
    if (chainSpan.lengthSq() < 1e-10) return; // Degenerate all-transparent/one-pixel chain cannot form a lever.
    chainSpan.normalize();
    if (!state.hasPivot || pivot.distanceToSquared(state.lastPivot) > 9) {
      state.direction.set(0, -1, 0);
      state.lastPivot.copy(pivot);
      state.hasPivot = true;
    }
    const velocity = q.velocity.copy(pivot).sub(state.lastPivot).divideScalar(Math.max(0.001, dt));
    state.lastPivot.copy(pivot);
    const motion = flail.motion || {}; // Authored inertial controls from the Tool Hub; ordinary stances are not modified.
    const lag = Number.isFinite(Number(motion.lag)) ? Math.max(0, Math.min(1, Number(motion.lag))) : MOTION_LAG;
    const shaftUp = q.shaftUp.set(0, 1, 0).applyQuaternion(baseQ).normalize(); // Real, fully-posed tool direction; no hardcoded attack-up target.
    const pitchAxis = q.pitchAxis.set(1, 0, 0).applyQuaternion(baseQ).normalize(); // Tool pitch rotates around local X, including its parent/body rotations.
    if (state.attacking && (!state.wasAttacking || state.progress < state.lastFrameProgress - 0.01)) {
      state.strikeTurnRad = 0; state.hasShaftUp = false; // A new attack cannot inherit the last hold's rotation.
    }
    if (state.attacking && state.hasShaftUp && state.progress > state.wf && state.progress <= state.sf) {
      const sine = q.pitchCross.crossVectors(state.lastShaftUp, shaftUp).dot(pitchAxis);
      const turn = Math.atan2(sine, Math.max(-1, Math.min(1, state.lastShaftUp.dot(shaftUp))));
      if (Math.abs(turn) < 0.5) state.strikeTurnRad += turn; // Observe pitch for procedural swings without explicit pose metadata.
    }
    state.lastShaftUp.copy(shaftUp); state.hasShaftUp = true;
    state.wasAttacking = state.attacking; state.lastFrameProgress = state.progress;
    const followShaft = state.attacking && state.progress >= state.wf * 0.8; // Straighten early, BEFORE the windup-to-strike transition.
    if (followShaft) {
      const pitchTravel = state.pitchTravelRad ?? state.strikeTurnRad;
      const extra = flailPitchOvershoot(state.progress, state.sf, state.hf, pitchTravel);
      state.direction.copy(shaftUp).applyQuaternion(q.stepQ.setFromAxisAngle(pitchAxis, extra)).normalize(); // Follow the exact tool pitch, then rotate beyond it during hold.
    } else {
      const target = state.attacking ? q.target.copy(shaftUp)
        : q.target.set(-velocity.x * lag, -1, -velocity.z * lag).normalize(); // Outside combat, retain the existing hanging-chain inertia.
      const turnAngle = state.direction.angleTo(target);
      if (turnAngle > 1e-6) {
        const maxTurn = Math.max(0.001, Math.min(MAX_DT, dt))
          * Math.max(0.1, Math.min(60, Number(state.attacking ? motion.attackFollow : motion.idleFollow) || (state.attacking ? 15 : 7)));
        q.deltaQ.setFromUnitVectors(state.direction, target);
        q.stepQ.identity().slerp(q.deltaQ, Math.min(1, maxTurn / turnAngle));
        state.direction.applyQuaternion(q.stepQ).normalize();
      }
    }
    const worldQ = planeQuaternion(q.headUp.copy(state.direction).negate(), normal, q.worldQ, q);
    worldQ.multiply(q.correction.setFromUnitVectors(chainSpan, q.axisUp)); // Align both opaque chain endpoints, not the image rectangle.
    const chainCenterWorld = q.chainCenter.copy(pivot).sub(q.tmp.copy(topLocal).multiplyScalar(attachmentScale).applyQuaternion(worldQ)); // Keep the already axis-scaled top contact pinned to the haft.
    root.updateWorldMatrix(true, false);
    const rootQInverse = root.getWorldQuaternion(q.rootInverseQ).invert();
    state.chain.position.copy(root.worldToLocal(q.chainLocal.copy(chainCenterWorld)));
    state.chain.quaternion.copy(rootQInverse).multiply(worldQ);
    const endWorld = q.endWorld.copy(chainCenterWorld).add(q.tmp.copy(bottomLocal).multiplyScalar(attachmentScale).applyQuaternion(worldQ)); // Use the stretched bottom endpoint without rescaling the head.
    const headSpec = flail.head;
    // The brazier remains world-up at rest; in a swing its top faces the haft.
    const headUp = state.attacking ? q.headUp.copy(state.direction).negate() : q.headUp.set(0, 1, 0);
    const headQ = planeQuaternion(headUp, normal, q.headQ, q);
    const layer = headSpec.layers.find(candidate => candidate.id === headSpec.anchorLayer); // Per-head authoring offset for the actual chain contact layer.
    const headAnchorLocal = headSpec.anchorSpace === 'composite'
      ? q.headAnchorLocal.set(state.headAnchor.x * unit, -state.headAnchor.y * unit, 0)
      : pixelPoint(state.headAnchorImage, state.headAnchor, unit, layer?.offsetPx, q.headAnchorLocal); // Shared center-frame contacts are allowed in the transparent gap between two sprite layers.
    const headCenterWorld = q.headCenter.copy(endWorld).sub(q.tmp.copy(headAnchorLocal).multiplyScalar(attachmentScale * headScale).applyQuaternion(headQ)); // Keep the independently scaled head contact at the scaled chain's end.
    state.headRoot.position.copy(root.worldToLocal(q.headLocal.copy(headCenterWorld)));
    state.headRoot.quaternion.copy(rootQInverse).multiply(headQ);
    if (root.visible !== false) effects?.stepFire(state, dt); // Flame stays in the assembled head and behind later opaque sprites.
  }

  function tick(deltaS) {
    const now = performance.now();
    const dt = Math.min(MAX_DT, Math.max(0.001, Number(deltaS) || 1 / 60));
    for (const state of records) {
      if (state.dead) { records.delete(state); continue; }
      try {
        effects?.refreshMetal(state, now); // Throttled tint updates share weapon plating and verdigris without creating a second animation loop.
        updateOne(state, dt, now);
      }
      catch (error) {
        if (!state.lastErrorAt || now - state.lastErrorAt > 5000) {
          state.lastErrorAt = now;
          report(state.itemKey + ': ' + (error?.stack || error?.message || error));
        }
      }
    }
  }

  function debugSnapshot() {
    return [...records].map(s => ({
      itemKey: s.itemKey, loaded: !!(s.chain && s.headRoot),
      attached: !!s.root.parent, attacking: s.attacking,
      progress: s.progress, direction: s.direction.toArray(),
      attackTiming: { windup: s.wf, strike: s.sf, hold: s.hf }, // Mobile-readable phase diagnostics.
      pitchTravelDeg: Number.isFinite(s.pitchTravelRad) ? s.pitchTravelRad * 180 / Math.PI : s.strikeTurnRad * 180 / Math.PI, // Shows what drives hold-through rotation.
      scale: s.config.flail ? {
        chainX: connectorAxisScale(s.config.flail.chain, 'scaleX'),
        chainY: connectorAxisScale(s.config.flail.chain, 'scaleY'),
        head: relativePartScale(s.config.flail.head),
      } : null, // Mobile diagnostics expose both independent connector axes.
      connector: s.config.flail?.chain?.type === 'rope' ? 'rope' : s.config.flail ? 'chain' : null, // Mobile diagnostics expose both handle-relative multipliers.
    }));
  }

  function enchantmentTargets(visual) {
    const sourceTargets = states.get(visual)?.metalTargets || []; // Source masks exclude covered head/weapon metal; never include the chain.
    const plane = visual?.userData?.toolPlane;
    if (!plane || !global.HobunjiDualWieldWeaponVisuals?.debugSnapshot?.()?.active) return sourceTargets;
    // Dual-wielded ordinary layered weapons duplicate their visible base and
    // overlay meshes. Redirect enchantments to the two visible copies rather
    // than emitting at the hidden midpoint or at the original layers.
    const copies = [];
    plane.traverse?.(node => {
      const parentSource = node?.userData?.hobunjiDualWeaponSourceLayer; // The exact source layer cloned by the dual-wield renderer.
      for (const target of sourceTargets) {
        if (parentSource === target.plane
          || (target.plane === plane && node?.userData?.hobunjiDualWieldDuplicate)) {
          copies.push({ plane: node, mask: target.mask });
        }
      }
    });
    return copies;
  }

  global.HobunjiWeaponSpriteAssemblies = {
    definitions: DEF, decorate, setAction, tick, drop, debugSnapshot, enchantmentTargets,
    opaqueAt, anchor, definitionFor, flailPitchOvershoot, // Deterministic phase helper exposed for focused regression tests.
  };
  if (global.RuntimeFrameScheduler?.register) {
    global.RuntimeFrameScheduler.register('weapon-sprite-assemblies', context => tick((context?.deltaMs || 0) / 1000), {
      phase: 'pre-render', owner: 'HobunjiWeaponSpriteAssemblies',
      description: 'Updates layered weapons and world-space chain/head positions just before drawing',
    });
  }
})(window);
