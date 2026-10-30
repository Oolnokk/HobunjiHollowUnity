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
  const DEF = Object.freeze({
    hachutuTorchFlail: {
      flail: {
        haftAnchor: { opaque: 'top' }, // Safe initial mounting point; override with { x, y } in PNG pixels when authored.
        chain: { sprite: 'assets/toolsprites/hachutu_torch-flail_chain.png' },
        head: {
          anchorLayer: 'handle', // The chain terminates on the lower opaque end of this brazier component.
          anchor: { opaque: 'bottom' }, // Supports an explicitly authored { x, y } pixel coordinate instead.
          layers: [
            { id: 'back', sprite: 'assets/toolsprites/torch-flail_brazier-back.png' },
            { id: 'fuel', sprite: 'assets/toolsprites/torch-flail_brazier-fuel.png' },
            { id: 'handle', sprite: 'assets/toolsprites/torch-flail_brazier-handle.png' },
            { id: 'front', sprite: 'assets/toolsprites/torch-flail_brazier-front.png' },
          ],
        },
      },
    },
  }); // Default Hachutu assembly; the same data shape may be supplied by any future TOOL_ITEM_DEFS entry.

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
    mesh.userData.hobunjiWeaponAssemblyPart = true;
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
      headRoot: null, headAnchorImage: null, chainImage: null,
      direction: new THREE.Vector3(0, -1, 0), lastPivot: new THREE.Vector3(), hasPivot: false,
      baseAnchorImage: null, baseAnchor: null, chainTop: null, chainBottom: null, headAnchor: null,
      scratch: {
        pivotLocal: new THREE.Vector3(), pivot: new THREE.Vector3(), velocity: new THREE.Vector3(),
        normal: new THREE.Vector3(), scale: new THREE.Vector3(), target: new THREE.Vector3(),
        up: new THREE.Vector3(), orientedNormal: new THREE.Vector3(), right: new THREE.Vector3(),
        axisUp: new THREE.Vector3(0, 1, 0), headUp: new THREE.Vector3(), span: new THREE.Vector3(),
        topLocal: new THREE.Vector3(), bottomLocal: new THREE.Vector3(), headAnchorLocal: new THREE.Vector3(),
        chainCenter: new THREE.Vector3(), endWorld: new THREE.Vector3(), headCenter: new THREE.Vector3(),
        chainLocal: new THREE.Vector3(), headLocal: new THREE.Vector3(), tmp: new THREE.Vector3(),
        baseQ: new THREE.Quaternion(), rootInverseQ: new THREE.Quaternion(),
        worldQ: new THREE.Quaternion(), headQ: new THREE.Quaternion(), correction: new THREE.Quaternion(),
        deltaQ: new THREE.Quaternion(), stepQ: new THREE.Quaternion(), basis: new THREE.Matrix4(),
      }, // Reused by every animation frame, avoiding repeated vector/quaternion/matrix allocations.
      attacking: false, progress: 0, detachedAt: 0, dead: false,
    }; // Tracks per-instance lag, asset loading and render nodes without altering the original grip.
    states.set(root, state);
    records.add(state);
    const layers = def?.spriteLayers || config.layers || [];
    const setup = async () => {
      const baseImg = plane.material?.map?.image;
      if (!baseImg?.width && !baseImg?.naturalWidth) return;
      const unit = (plane.geometry?.parameters?.width || 0.5) / (baseImg.naturalWidth || baseImg.width);
      const order = plane.renderOrder || 1.5;
      for (const layer of layers) {
        const texture = await textureFor(THREE, layer.sprite);
        if (state.dead) return;
        const mesh = buildPlane(THREE, texture.image, texture, unit, order + (state.owned.length + 1) * 0.001, layer.offsetPx);
        // Static layers share the haft's exact end flip, mirrored stance and attack rotation.
        mesh.position.z = 0.001 * (state.owned.length + 1);
        plane.add(mesh);
        state.owned.push(mesh);
      }
      if (!config.flail) return;
      const f = config.flail;
      const chainTex = await textureFor(THREE, f.chain.sprite);
      if (state.dead) return;
      const headTextures = await Promise.all(f.head.layers.map(layer => textureFor(THREE, layer.sprite)));
      if (state.dead) return;
      const chainImg = chainTex.image;
      const chain = buildPlane(THREE, chainImg, chainTex, unit, order + 0.01);
      const headRoot = new THREE.Group();
      headRoot.name = itemKey + '_flail_head';
      headRoot.userData.hobunjiWeaponAssemblyPart = false;
      f.head.layers.forEach((layer, i) => {
        const mesh = buildPlane(THREE, headTextures[i].image, headTextures[i], unit, order + 0.02 + i * 0.001, layer.offsetPx);
        headRoot.add(mesh);
        state.headParts.push(mesh);
      });
      root.add(chain, headRoot);
      state.owned.push(chain, headRoot);
      state.chain = chain;
      state.headRoot = headRoot;
      state.headAnchorImage = headTextures[f.head.layers.findIndex(layer => layer.id === f.head.anchorLayer) >= 0
        ? f.head.layers.findIndex(layer => layer.id === f.head.anchorLayer) : 0].image;
      state.chainImage = chainImg;
      state.chainTop = anchor(chainImg, f.chain.top, 'top'); // Cached alpha anchor shared by all animation frames.
      state.chainBottom = anchor(chainImg, f.chain.bottom, 'bottom');
      state.headAnchor = anchor(state.headAnchorImage, f.head.anchor, 'bottom'); // Head mounting point is fixed relative to its layer.
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
    state.progress = Number.isFinite(options.progress) ? options.progress : 0;
  }

  function updateOne(state, dt, now) {
    const { root, plane, config, scratch: q } = state;
    if (!root.parent) {
      if (!state.detachedAt) state.detachedAt = now;
      if (now - state.detachedAt > DETACHED_TIMEOUT) drop(root);
      return;
    }
    state.detachedAt = 0;
    if (!state.chain || !state.headRoot) return;
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
    root.getWorldScale(q.scale); // Layer geometry inherits the parent tool grip/height scaling.
    const attachmentScale = Math.max(0.01, Math.abs(q.scale.x)); // Pixel offsets are scaled once in world, matching their visible meshes.
    const topLocal = pixelPoint(state.chainImage, state.chainTop, unit, null, q.topLocal);
    const bottomLocal = pixelPoint(state.chainImage, state.chainBottom, unit, null, q.bottomLocal);
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
    const target = state.attacking
      ? q.target.set(0, 1, 0).applyQuaternion(baseQ).normalize()
      : q.target.set(-velocity.x * MOTION_LAG, -1, -velocity.z * MOTION_LAG).normalize();
    // Angular follow avoids the 180-degree deadlock of normalized linear lerp.
    const turnAngle = state.direction.angleTo(target);
    if (turnAngle > 1e-6) {
      const maxTurn = Math.max(0.001, Math.min(MAX_DT, dt)) * (state.attacking ? 15 : 7); // Fast lever on attack, gentler travel lag at rest.
      q.deltaQ.setFromUnitVectors(state.direction, target);
      q.stepQ.identity().slerp(q.deltaQ, Math.min(1, maxTurn / turnAngle));
      state.direction.applyQuaternion(q.stepQ).normalize();
    }
    const worldQ = planeQuaternion(q.headUp.copy(state.direction).negate(), normal, q.worldQ, q);
    worldQ.multiply(q.correction.setFromUnitVectors(chainSpan, q.axisUp)); // Align both opaque chain endpoints, not the image rectangle.
    const chainCenterWorld = q.chainCenter.copy(pivot).sub(q.tmp.copy(topLocal).multiplyScalar(attachmentScale).applyQuaternion(worldQ));
    root.updateWorldMatrix(true, false);
    const rootQInverse = root.getWorldQuaternion(q.rootInverseQ).invert();
    state.chain.position.copy(root.worldToLocal(q.chainLocal.copy(chainCenterWorld)));
    state.chain.quaternion.copy(rootQInverse).multiply(worldQ);
    const endWorld = q.endWorld.copy(chainCenterWorld).add(q.tmp.copy(bottomLocal).multiplyScalar(attachmentScale).applyQuaternion(worldQ));
    const headSpec = flail.head;
    // The brazier remains world-up at rest; in a swing its top faces the haft.
    const headUp = state.attacking ? q.headUp.copy(state.direction).negate() : q.headUp.set(0, 1, 0);
    const headQ = planeQuaternion(headUp, normal, q.headQ, q);
    const layer = headSpec.layers.find(candidate => candidate.id === headSpec.anchorLayer); // Per-head authoring offset for the actual chain contact layer.
    const headAnchorLocal = pixelPoint(state.headAnchorImage, state.headAnchor, unit, layer?.offsetPx, q.headAnchorLocal);
    const headCenterWorld = q.headCenter.copy(endWorld).sub(q.tmp.copy(headAnchorLocal).multiplyScalar(attachmentScale).applyQuaternion(headQ));
    state.headRoot.position.copy(root.worldToLocal(q.headLocal.copy(headCenterWorld)));
    state.headRoot.quaternion.copy(rootQInverse).multiply(headQ);
  }

  function tick(deltaS) {
    const now = performance.now();
    const dt = Math.min(MAX_DT, Math.max(0.001, Number(deltaS) || 1 / 60));
    for (const state of records) {
      if (state.dead) { records.delete(state); continue; }
      try { updateOne(state, dt, now); }
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
    }));
  }

  global.HobunjiWeaponSpriteAssemblies = {
    definitions: DEF, decorate, setAction, tick, drop, debugSnapshot,
    opaqueAt, anchor, definitionFor,
  };
  if (global.RuntimeFrameScheduler?.register) {
    global.RuntimeFrameScheduler.register('weapon-sprite-assemblies', context => tick((context?.deltaMs || 0) / 1000), {
      phase: 'pre-render', owner: 'HobunjiWeaponSpriteAssemblies',
      description: 'Updates layered weapons and world-space chain/head positions just before drawing',
    });
  }
})(window);
