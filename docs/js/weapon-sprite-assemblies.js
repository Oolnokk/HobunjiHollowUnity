// Reusable layered PNG weapons and flexible chain/head assemblies.
// The existing held-tool plane remains the pose, hand-grip and hit authority.
// Optional spriteLayers are static overlays; an optional flail adds a hanging,
// independently oriented chain and a layered head. Nothing here changes combat.
(function (global) {
  'use strict';
  if (global.HobunjiWeaponSpriteAssemblies) return;

  const scriptUrl = document.currentScript?.src || new URL('js/weapon-sprite-assemblies.js', location.href).href; // Resolves shared art from either gameplay or the attack editor.
  const images = new Map(); // Loaded source textures; each visible mesh clones the texture so editor disposal never damages the cache.
  const records = new Set(); // Weak references to assembled roots; the animation scheduler must never become an equipment owner.
  const states = new WeakMap(); // Root-owned assembly state survives unequipping, but retired weapons remain garbage-collectible.
  const weakRegistry = typeof WeakRef === 'function'; // Supported browsers keep dormant weapons alive only through their actual equipment/actor caches.
  const gpuFinalizer = weakRegistry && typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry(resources => {
        for (const resource of resources) {
          try { resource?.dispose?.(); } catch (_) { /* GC cleanup cannot interrupt game rendering. */ }
        }
      })
    : null; // Releases only assembly-owned GPU resources once an abandoned root is collected; explicit drop still cleans immediately.
  const alphaBounds = new WeakMap(); // Transparent-pixel anchor scans are cached by the loaded image.
  const ropeSpriteBounds = new WeakMap(); // Original ruin rope alpha extents are scanned once per decoded image; every flail shares the result.
  const tintedRopeTextures = new WeakMap(); // Retains reusable recolored templates for each source PNG; live weapons own independent texture clones.
  const ROPE_TINT_CACHE_LIMIT = 12; // Limits the full-resolution canvas footprint when mobile authors try many rope colors.
  const PIXEL_ALPHA = 128; // Treat only the solid half of an antialiased edge as the opaque connection tip.
  const MAX_DT = 0.08; // Prevent tab-resume and loading stalls from launching the head sideways.
  const MOTION_LAG = 0.065; // Converts haft travel velocity to idle trailing angle.
  const HEAD_MOVE_EPSILON=.035, HEAD_LEAN_PER_SPEED=.14, HEAD_SETTLE_RATE=10; // World units/s, radians per unit/s, and exponential settling per second.
  const HEAD_YAW_CENTER=3*Math.PI/180; // NPC portrait clamp center hysteresis.
  function headDeadzone(){return Math.max(0,Math.min(Math.PI/2,global.PerpRotation?.PERP_DEAD_RAD??(global.SCRATCHBONES_CONFIG?.game?.movement?.perpRotDeadzoneDeg??40)*Math.PI/180));}
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
      const pending = new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(url, tex => {
          const surface = global.HobunjiSpritePngSurface || global.HobunjiPngPlaneUnlit;
          if (surface?.configureTexture) surface.configureTexture(THREE, tex, url); // Shared authored PNG color-management and filtering policy.
          else tex.magFilter = tex.minFilter = THREE.NearestFilter;
          resolve(tex);
        }, undefined, reject);
      }).catch(error => {
        images.delete(url); // A transient missing PNG must not poison all future weapons sharing its cached promise.
        throw error;
      });
      images.set(url, pending);
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

  // NPC front-portrait convention: edge-on at camera bearing +/-90 degrees.
  // Allocation-free clamp, preserving the selected side within center hysteresis.
  function clampIdleHeadYaw(motion,yaw,viewYaw,deadRad) {
    if(!Number.isFinite(viewYaw)||!(deadRad>0))return yaw;
    const first=viewYaw+Math.PI/2;
    const delta=Math.atan2(Math.sin(yaw-first),Math.cos(yaw-first));
    const index=Math.abs(delta)<=Math.PI/2?0:1;
    const d=index===0?delta:delta>0?delta-Math.PI:delta+Math.PI;
    const side=motion.perp===index&&motion.side&&Math.abs(d)<HEAD_YAW_CENTER?motion.side:d>0?1:-1;
    motion.side=side;motion.perp=index;
    return Math.abs(d)<deadRad?first+index*Math.PI+side*deadRad:yaw;
  }
  function stepIdleHeadMotion(motion,vx,vz,dt,seedYaw,deadRad) {
    if(!Number.isFinite(motion.yaw))motion.yaw=seedYaw;
    if(!(dt>0))return motion;
    const speed=Math.hypot(vx,vz);
    const moving=Number.isFinite(speed)&&speed>HEAD_MOVE_EPSILON;
    if(!moving&&motion.leanX===0&&motion.leanZ===0)return motion; // Exact idle equilibrium: no exponential/trigonometry.
    if(moving)motion.yaw=Math.atan2(vx,vz);
    const target=moving?Math.min(deadRad,speed*HEAD_LEAN_PER_SPEED)/speed:0;
    const blend=1-Math.exp(-HEAD_SETTLE_RATE*dt);
    motion.leanX+=(moving?vx*target-motion.leanX:-motion.leanX)*blend;
    motion.leanZ+=(moving?vz*target-motion.leanZ:-motion.leanZ)*blend;
    if(!moving&&Math.hypot(motion.leanX,motion.leanZ)<.001)motion.leanX=motion.leanZ=0;
    return motion;
  }
  // Measure the actual baked rope attachment independently of the pendulum's resettable
  // pivot history. Only strike recovery can feed an idle head impulse; locomotion wins.
  function resetIdleHeadMotion(m,resetYaw=false) {
    m.leanX=m.leanZ=m.returnX=m.returnZ=0;
    m.tipReady=m.previousAttack=m.sawStrike=false;m.previousProgress=0;
    if(resetYaw){m.yaw=m.displayYaw=m.renderedYaw=m.perp=null;m.side=0;m.source='initial';}
  }
  function bodyYawRate(deltaTime, previousYaw, yaw) {
    if(!(deltaTime>0)||!Number.isFinite(previousYaw))return 0;
    const delta=Math.atan2(Math.sin(yaw-previousYaw),Math.cos(yaw-previousYaw)); // Heading wraps seamlessly through ±π.
    return Math.abs(delta)<=Math.PI/2?delta/deltaTime:0; // Abrupt facing resets cannot kick the head.
  }
  function advanceIdleHeadMotion(m,attacking,progress,strikeFrac,holdFrac,pivot,bodyVX,bodyVZ,dt,seedYaw,deadRad) {
    if(!Number.isFinite(m.yaw))m.yaw=seedYaw;
    if(!(dt>0)) {
      // Initialization may establish a neutral baseline, but paused redraws cannot consume a return.
      if(!m.tipReady){m.tipReady=true;m.tipX=pivot.x;m.tipY=pivot.y;m.tipZ=pivot.z;}
      return;
    }
    const dx=pivot.x-m.tipX,dy=pivot.y-m.tipY,dz=pivot.z-m.tipZ;
    const valid=m.tipReady&&dx*dx+dy*dy+dz*dz<=9;
    if(!valid)resetIdleHeadMotion(m);
    let vx=0,vz=0,tipMoving=false;
    if(valid&&(attacking||m.previousAttack)){
      vx=dx/dt-bodyVX;vz=dz/dt-bodyVZ;
      tipMoving=Number.isFinite(vx)&&Number.isFinite(vz)&&vx*vx+vz*vz>HEAD_MOVE_EPSILON*HEAD_MOVE_EPSILON;
    }
    m.tipReady=true;m.tipX=pivot.x;m.tipY=pivot.y;m.tipZ=pivot.z;
    const bodyMoving=Number.isFinite(bodyVX)&&Number.isFinite(bodyVZ)&&bodyVX*bodyVX+bodyVZ*bodyVZ>HEAD_MOVE_EPSILON*HEAD_MOVE_EPSILON;
    if(attacking){
      if(!m.previousAttack||progress<m.previousProgress-.01||!valid){
        m.sawStrike=false;m.returnX=m.returnZ=0;
      }
      if(progress>=strikeFrac)m.sawStrike=true;
      if(m.sawStrike&&progress>=holdFrac&&tipMoving){m.returnX=vx;m.returnZ=vz;}
      m.leanX=m.leanZ=0; // The existing attack quaternion still owns active swings.
    }else{
      const returned=m.previousAttack&&m.sawStrike&&valid;
      if(bodyMoving){
        m.source='locomotion';
        stepIdleHeadMotion(m,bodyVX,bodyVZ,dt,seedYaw,deadRad);
      }else if(returned){
        // Prefer the real last return step; a fully settled final keyframe uses
        // the most recent nonzero recovery sample instead. Consume exactly once.
        const x=tipMoving?vx:m.returnX,z=tipMoving?vz:m.returnZ,speed=Math.hypot(x,z);
        if(speed>HEAD_MOVE_EPSILON){
          const magnitude=Math.min(deadRad,speed*HEAD_LEAN_PER_SPEED);
          m.yaw=Math.atan2(x,z);m.leanX=x/speed*magnitude;m.leanZ=z/speed*magnitude;
          m.source='strike-return';
        }else stepIdleHeadMotion(m,0,0,dt,seedYaw,deadRad);
      }else stepIdleHeadMotion(m,0,0,dt,seedYaw,deadRad);
      m.sawStrike=false;m.returnX=m.returnZ=0;
    }
    m.previousAttack=attacking;m.previousProgress=progress;
  }

  // Solve the tilted plane's NORMAL from its desired horizontal yaw and its
  // tilted up vector. Pitching a yawed quaternion directly drifts its actual
  // horizontal normal back into the forbidden NPC deadzone.
  function leanHeadBasis(leanX,leanZ,lean,yaw,up,normal){
    const scale=Math.sin(lean)/Math.hypot(leanX,leanZ);
    up.set(leanX*scale,Math.cos(lean),leanZ*scale);
    const x=Math.sin(yaw),z=Math.cos(yaw);
    normal.set(x,-(up.x*x+up.z*z)/Math.max(1e-8,up.y),z);
  }
  function easeIdleHeadYaw(previous,target,dt){
    if(!Number.isFinite(previous))return target;
    const delta=Math.atan2(Math.sin(target-previous),Math.cos(target-previous)); // Follow the short arc across the yaw wrap.
    return previous+delta*(1-Math.exp(-5*Math.max(0,dt)));
  }
  function idleHeadQuaternion(state,pivot,normal,out,dt) {
    const q=state.scratch,motion=state.idleHeadMotion; // Each actual hand has its own baked tip; dual wield still shares actor motion and rope physics.
    const deadRad=headDeadzone();
    const camera=state.cameraPosition||global.SharedAttackPose?.getCameraPosition?.()||global.PerpRotation?.liveCameraPosition?.();
    const rawYaw=Number.isFinite(motion.yaw)?motion.yaw:Math.atan2(normal.x,normal.z);
    const viewYaw=camera&&Math.hypot(camera.x-pivot.x,camera.z-pivot.z)>1e-8?Math.atan2(camera.x-pivot.x,camera.z-pivot.z):null;
    motion.displayYaw=easeIdleHeadYaw(motion.displayYaw,rawYaw,dt);
    const yaw=clampIdleHeadYaw(motion,motion.displayYaw,viewYaw,deadRad);motion.renderedYaw=yaw;
    const lean=Math.min(deadRad,Math.PI/2-1e-5,Math.hypot(motion.leanX,motion.leanZ));
    if(lean<=1e-8)return out.setFromAxisAngle(q.axisUp,yaw);
    leanHeadBasis(motion.leanX,motion.leanZ,lean,yaw,q.headUp,q.tmp);
    return planeQuaternion(q.headUp,q.tmp,out,q);
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

  function buildPlane(THREE, image, tex, unit, order, offset = null, writesDepth = false) {
    const w = image.naturalWidth || image.width || 1;
    const h = image.naturalHeight || image.height || 1;
    const geometry = new THREE.PlaneGeometry(w * unit, h * unit);
    const map = tex.clone(); // Per-mesh map ownership keeps editor teardown safe.
    map.needsUpdate = true;
    const surface = global.HobunjiSpritePngSurface || global.HobunjiPngPlaneUnlit; // Use the same unlit PNG material pipeline as the game's other sprites.
    const material = surface?.makeMaterial
      ? surface.makeMaterial(THREE, map, 'weapon-assembly-layer', { side: THREE.DoubleSide, depthWrite: writesDepth })
      : new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: writesDepth ? 0.35 : 0.08,
          side: THREE.DoubleSide, depthWrite: writesDepth }); // Only physical flail head/chain art writes depth; decorative weapon layers retain their original blending.
    if (writesDepth) {
      material.depthWrite = true; // A factory override must not disable solid head/chain depth in the held overlay.
      material.alphaTest = Math.max(Number(material.alphaTest) || 0, Number(surface?.maskAlphaTest?.()) || 0.35); // Match the game's solid PNG depth mask.
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((Number(offset?.x) || 0) * unit, -(Number(offset?.y) || 0) * unit, 0);
    mesh.renderOrder = order;
    mesh.userData.hobunjiHeldObjectPlane = true; // Reuse the existing held-object occlusion/replay pipeline for all chain/head layers.
    mesh.userData.hobunjiWeaponAssemblyPart = true; // HeldObjectRenderOrder preserves this assembly plane's ordered overlay layer.
    mesh.userData.noOutline = true; // The weapon PNG already contains its hand-drawn ink: never submit an inverted shell.
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

  function trackOwnedGpuResources(state) {
    if (!state.gcResources) return; // Older environments use deterministic drop without retaining a second resource registry.
    for (const part of state.owned) part.traverse?.(node => {
      if (!node.userData?.hobunjiWeaponAssemblyPart) return;
      if (node.geometry) state.gcResources.add(node.geometry);
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!material) continue;
        state.gcResources.add(material);
        if (material.map) state.gcResources.add(material.map); // Mesh textures are cloned; never finalize shared source PNGs.
      }
    });
    if (state.ownedBaseMap) state.gcResources.add(state.ownedBaseMap); // Owns only the marker recolor clone, never the original held-tool map.
  }

  function liveState(entry) {
    const root = weakRegistry ? entry.deref() : entry; // Do not prolong a retired actor's lifetime just because it was once rendered.
    return root ? states.get(root) : null;
  }

  function drop(root) {
    const state = states.get(root);
    if (!state) return;
    state.dead = true;
    records.delete(state.registryEntry);
    if (gpuFinalizer) gpuFinalizer.unregister(state.finalizerToken); // Explicit disposal wins over eventual garbage-collection cleanup.
    effects?.dispose(state); // Dispose pooled fire sprites before removing their head owner.
    if (state.ownedBaseMap) {
      if (state.plane.material.map === state.ownedBaseMap) {
        state.plane.material.map = state.originalBaseMap;
        state.plane.material.needsUpdate = true;
      }
      state.ownedBaseMap.dispose();
    }
    for (const child of state.owned) destroyPart(child);
    state.gcResources?.clear(); // Do not retain disposed textures/materials through a previously cached state.
    states.delete(root);
  }

  function assemblyKind(root) { const state=states.get(root);return state?.config?.flail?'flail':state?'layered':null; }
  function isGroundNonSolidChild(plane,child){
    const state=states.get(plane?.parent);
    if(!state||state.plane!==plane)return false;
    // Only exact emitter-owned groups are exempt. Real PNG overlays remain solid.
    return !!state.fireEmitters?.some(fx=>fx.group===child&&child.userData?.weaponInterleavedVfx===true);
  } // Exact decorated root, not a guessed tool-name alias.
  function definitionFor(itemKey, def) {
    return def?.weaponAssembly || DEF[itemKey] || DEF[def?.shapeKey] || (Array.isArray(def?.spriteLayers) && def.spriteLayers.length ? { layers: def.spriteLayers } : null);
  }

  // Called at the existing tool-plane factory, so player, bandits, NPC props
  // and the Attack Editor see the same static layers and flexible attachments.
  function decorate(root, itemKey, def, options = {}) {
    const THREE = options.THREE || global.THREE;
    const config = definitionFor(itemKey, def);
    if (!root?.userData?.toolPlane || !THREE || !config) return root;
    const existing = states.get(root);
    if (existing) {
      // The same cached handle can be decorated again when its slot is reselected.
      // Restore temporarily detached connector/head without rebuilding or disposing their materials.
      if (existing.chain && existing.chain.parent !== root) { root.add(existing.chain); existing.repairedParts++; }
      if (existing.headRoot && existing.headRoot.parent !== root) { root.add(existing.headRoot); existing.repairedParts++; }
      return root;
    }
    const plane = root.userData.toolPlane;
    const state = {
      root, plane, itemKey, THREE, config, owned: [], headParts: [], chain: null,
      metalOptions: options.metalOptions || null, masteryLevel: options.masteryLevel || (() => 0), resolveAsset: imageUrl, // Live XP rank drives authored non-metal VFX, while metal still uses plating/mastery options.
      headRoot: null, headAnchorImage: null, chainImage: null,
      direction: new THREE.Vector3(0, -1, 0), strikeStartDirection: new THREE.Vector3(0, -1, 0), lastPivot: new THREE.Vector3(), hasPivot: false, // Preserves the gravitational chain orientation only when the strike begins.
      idleHeadMotion:{yaw:null,leanX:0,leanZ:0,renderedYaw:null,side:0,perp:null,tipReady:false,tipX:0,tipZ:0,tipY:0,returnX:0,returnZ:0,previousAttack:false,previousProgress:0,sawStrike:false,source:'initial'}, cameraPosition:null, // Retained logical heading and smoothed lean, separate from pendulum.
      lastMovementPosition: new THREE.Vector3(), hasMovementPosition: false, movementPosition: null, movementRoot:null, turnRoot:null, turnYaw:null, turnRate:0, // Character movement source supplied by gameplay, not the weapon's animated joint.
      angularVelocity: new THREE.Vector3(), pivotVelocity: new THREE.Vector3(), hasPhysicsVelocity: false, physicsLength: 0, // Persistent world-space pendulum momentum and measured lever length.
      equilibriumSkips: 0, // Diagnostic count of exact no-torque integration substeps skipped.
      lastShaftUp: new THREE.Vector3(), hasShaftUp: false, // Tracks observed pitch travel for procedural swings lacking authored pitch values.
      strikeTurnRad: 0, hasStrikeStart: false, wasAttacking: false, lastFrameProgress: 0, // The strike begins from the most recent gravity-and-lag position, never the shaft pose in windup.
      baseAnchorImage: null, baseAnchor: null, chainTop: null, chainBottom: null, headAnchor: null,
      scratch: {
        pivotLocal: new THREE.Vector3(), pivot: new THREE.Vector3(), velocity: new THREE.Vector3(),
        normal: new THREE.Vector3(), scale: new THREE.Vector3(), rootScale: new THREE.Vector3(), target: new THREE.Vector3(), // Cached world scales measure the handle against the holder for independent chain/head ratios.
        up: new THREE.Vector3(), orientedNormal: new THREE.Vector3(), right: new THREE.Vector3(),
        axisUp: new THREE.Vector3(0, 1, 0), headUp: new THREE.Vector3(), span: new THREE.Vector3(),
        previousDirection: new THREE.Vector3(), pivotAcceleration: new THREE.Vector3(), measuredPivotVelocity: new THREE.Vector3(), // Reused physics measurements, including actual animated haft movement.
        shaftUp: new THREE.Vector3(), pitchAxis: new THREE.Vector3(), pitchCross: new THREE.Vector3(), // Actual tool pitch direction and velocity for inertial hold-through.
        topLocal: new THREE.Vector3(), bottomLocal: new THREE.Vector3(), headAnchorLocal: new THREE.Vector3(),
        chainCenter: new THREE.Vector3(), endWorld: new THREE.Vector3(), headCenter: new THREE.Vector3(),
        chainLocal: new THREE.Vector3(), headLocal: new THREE.Vector3(), tmp: new THREE.Vector3(),
        baseQ: new THREE.Quaternion(), rootInverseQ: new THREE.Quaternion(), rootWorldQ: new THREE.Quaternion(), decomposePos: new THREE.Vector3(), // World matrices are decomposed in place; Object3D.getWorld*() would recompute from raw local transforms.
        inverseRootMatrix: new THREE.Matrix4(), // Converts both suspended parts back into their own baked holder frame without invoking worldToLocal().
        rootInverseWorld: new THREE.Matrix4(), partWorldMatrix: new THREE.Matrix4(), partWorldScale: new THREE.Vector3(), // Exact world-space rope/head transforms cancel non-uniform species body scaling.
        worldQ: new THREE.Quaternion(), headQ: new THREE.Quaternion(), correction: new THREE.Quaternion(),
        deltaQ: new THREE.Quaternion(), stepQ: new THREE.Quaternion(), basis: new THREE.Matrix4(),
      }, // Reused by every animation frame, avoiding repeated vector/quaternion/matrix allocations.
      attacking: false, progress: 0, wf: 0.16, sf: 0.28, hf: 0.68, pitchTravelRad: null, yawTravelRad: 0, detachedAt: 0, dead: false, // Per-weapon attack timing supplied by player, enemies, or editor.
      flailLengthScale: 1, hasExplicitFlailScale: false, // Pose multiplier is separate from the authored rope/chain length and never changes rigid heads or non-flails.
      fishingFlailHeadSpin: false, fishingFlailSpinRevolutions: 2.5, // Fishing-only head orbit; the shaft/hand pose remains the existing Spin Throw, without in-plane shaft rotation.
      registryEntry: weakRegistry ? new WeakRef(root) : root, // Frame iteration never strongly retains an unequipped actor/weapon graph.
      gcResources: gpuFinalizer ? new Set() : null, // Finalizer holds only cloned GPU resources, not meshes, groups, state, or root.
      finalizerToken: {}, // Explicit drop unregisters only this weapon's finalization callback.
      originalDef: def, originalOptions: options, // A failed async source load can reconstruct this exact authored part recipe, not a generic fallback.
      setupFailed: false, nextRetryAt: 0, repairedParts: 0, // Pre-render retry and recovery counters are visible through mobile diagnostics.
    }; // Tracks per-instance lag, asset loading and render nodes without altering the original grip.
    states.set(root, state);
    records.add(state.registryEntry);
    gpuFinalizer?.register(root, state.gcResources, state.finalizerToken);
    const layers = config.layers || def?.spriteLayers || []; // Committed Tool Hub recipe overrides shape defaults when both are present.
    const setupFailure = error => {
      if (state.dead) return;
      trackOwnedGpuResources(state); // Partial setups still release owned textures if this root later becomes unreachable.
      state.setupFailed = true;
      state.nextRetryAt = performance.now() + 2000; // Retriable source/texture failures get a short, bounded-backoff window.
      report(itemKey + ': ' + (error?.message || error));
    }; // Reinitialization is deferred to the owner-attached tick, avoiding overlapping async setup calls.
    const modularShaft = def?.modular && global.ModularWeapons?.getConfig?.().shafts?.[def.modular.shaft]; // Foundry shaft can own the entire living weapon and its VFX.
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
      if (modularShaft && modularShaft.fireAssembly === def?.shapeKey && config.base?.vfx?.type === 'fire') {
        // A modular weapon's visible plane contains a composed metal head AND its shaft.
        // Never paint that composite with the shaft's marker recolor or erase the attached heads.
        const raw = await textureFor(THREE, modularShaft.sprite);
        if (state.dead) return;
        const image = raw.image;
        const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
        if (!(width > 0 && height > 0)) throw new Error('Modular fire shaft sprite missing dimensions.');
        const sourceUnit = 0.5 / width; // Original shaft source image pixels use the canonical 450-unit world width.
        const art = global.ModularWeapons?.shaftArtTransform?.(modularShaft)
          || {enabled:false,scaleX:1,scaleY:1,x:0,y:0}; // Only optional shaft-art control can affect living fuel and flames.
        const carrier = new THREE.Group(); // Shaft fire remains outside the overall rig and area groups.
        carrier.name = itemKey + '_modular_shaft_fire';
        carrier.position.set(art.enabled ? art.x * (0.5 / 450) : 0,
          art.enabled ? -art.y * (0.5 / 450) : 0, 0); // Source-frame center is the art-transform pivot.
        carrier.scale.set(art.enabled ? art.scaleX : 1,
          (1204 / 450) * (width / height) * (art.enabled ? art.scaleY : 1), 1); // Fire mirrors the opt-in shaft bitmap, not any head or region adjustments.
        carrier.renderOrder = order + 0.005;
        plane.add(carrier); state.owned.push(carrier);
        const visiblePlane = state.plane;
        state.plane = carrier; // Reuse the ordinary marker/fire emitter without recoloring the composite head's texture.
        try { effects?.activateStatic(state, config.base, [], [], image, sourceUnit); }
        finally { state.plane = visiblePlane; }
        state.staticReady = true;
      } else if (layers.length || config.base) {
        const rawBase = config.sprite || def?.sprite ? await textureFor(THREE, config.sprite || def.sprite) : null; // Read authored source pixels, not the live metal/plating canvas.
        if (state.dead) return;
        const source = rawBase?.image || baseImg;
        if (config.base?.material === 'marker' && plane.material?.map) {
          state.originalBaseMap = plane.material.map; // Restored if the base plane outlives the assembly.
          plane.material.map = state.ownedBaseMap = plane.material.map.clone(); // Do not recolor the shared in-hand texture used by other actors or inventory previews.
          plane.material.needsUpdate = true;
          plane.material.map.needsUpdate = true;
        }
        if (config.base) effects?.registerLayer(state, plane, { id: 'base', ...config.base }, source);
        effects?.activateStatic(state, config.base, layers, staticMeshes, source, unit); // Base-sprite fire also works with zero overlay layers.
        state.staticReady = true; // Mobile diagnostics distinguish finished single-sprite assembly from a still-loading rigid base.
      }
      if (!config.flail) { trackOwnedGpuResources(state); return; }
      const f = config.flail;
      const isRope = f.chain.type === 'rope'; // Generated suspension shares the same attachment animation as a raster chain.
      const chainTex = isRope ? null : await textureFor(THREE, f.chain.sprite);
      const ropeTexture = isRope ? await textureFor(THREE, f.chain.sprite || 'assets/objectsprites/rope_long.png') : null; // Original PNG shared with traversable ruin ropes.
      if (state.dead) return;
      const headTextures = await Promise.all(f.head.layers.map(layer => textureFor(THREE, layer.sprite)));
      if (state.dead) return;
      const authoredRopeScale = connectorAxisScale(f.chain, 'scaleY'); // Width and head scale are never inferred from a mount line.
      const requestedLength = Number(f.chain.mountLengthPx); // Present only on a modular rope mount, never an ordinary authored flail.
      const ropePixels = Math.max(2, Math.min(2048,
        isRope && Number.isFinite(requestedLength) && requestedLength > 0
          ? requestedLength / authoredRopeScale : Number(f.chain.lengthPx) || 160));
      const chainImg = isRope ? { width: 1, height: ropePixels + 1 } : chainTex.image; // Only the virtual rope endpoint span changes.
      const chain = isRope
        ? makeRope(THREE, { ...f.chain, lengthPx: ropePixels }, unit, order + 0.01, ropeTexture)
        : buildPlane(THREE, chainImg, chainTex, unit, order + 0.01, null, true); // Raster chains also x-ray as physical flail attachments.
      if (!isRope) effects?.registerLayer(state, chain, f.chain, chainImg); // Chain shares verdigris/plating; generated natural rope keeps its authored bark-brown surface.
      const headRoot = new THREE.Group();
      headRoot.name = itemKey + '_flail_head';
      headRoot.userData.hobunjiWeaponAssemblyPart = false;
      const pairVisual = f.head.visualTransform; // Only a modular replacement head needs the extra transform group.
      const headArtworkRoot = pairVisual ? new THREE.Group() : headRoot; // Original multilayer flails keep their flat, directly parented head sprites.
      if (pairVisual) {
        const sx = (Number(pairVisual.scaleX) || 1) * (pairVisual.flipX ? -1 : 1);
        const sy = (Number(pairVisual.scaleY) || 1) * (pairVisual.flipY ? -1 : 1);
        headArtworkRoot.scale.set(sx, sy, 1); // Flexible pair's head-only scale and flip.
        headArtworkRoot.rotation.z = -(Number(pairVisual.rotation) || 0) * Math.PI / 180; // Source bitmap Y is down, Three.js Y is up.
        headRoot.add(headArtworkRoot); // Avoid changing the legacy Grapple-Flail/Torch-Flail child hierarchy.
      }
      const headOrder = f.head.layerOrder === 'haft-over-head' ? order - 0.02 : order + 0.02; // Pair-only foreground choice; original multi-sprite flails keep their authored front order.
      f.head.layers.forEach((layer, i) => {
        const mesh = buildPlane(THREE, headTextures[i].image, headTextures[i], unit, headOrder + i * 0.001, layer.offsetPx, true); // Both authored head layers participate in held depth.
        headArtworkRoot.add(mesh); // Shared pair transform preserves authored per-layer geometry and effects.
        state.headParts.push(mesh);
        effects?.registerLayer(state, mesh, layer, headTextures[i].image);
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
      trackOwnedGpuResources(state); // Register complete head/rope clones for eventual owner-GC cleanup without retaining their root.
      // Place the suspension at the grip as soon as the artwork finishes loading.
      // Otherwise newly equipped flails briefly show their unpositioned, horizontal rope at the root origin.
      updateOne(state, 0, performance.now());
      global.__farmLog?.('[weapon assembly] ' + itemKey + ' chain/head ready', 'info'); // Visible in the existing mobile game diagnostic log.
    };
    // The base PNG can still be loading while the equipment holder is built.
    const baseImage = plane.material?.map?.image;
    if (baseImage?.width || baseImage?.naturalWidth) setup().catch(setupFailure);
    else {
      const startAt = performance.now();
      const trySetup = () => {
        if (state.dead) return;
        if (plane.material?.map?.image?.width || plane.material?.map?.image?.naturalWidth) {
          setup().catch(setupFailure);
        } else if (performance.now() - startAt < 10000) setTimeout(trySetup, 50);
        else setupFailure(new Error('base PNG did not finish loading'));
      };
      trySetup();
    }
    return root;
  }

  function setAction(root, options = {}) {
    const state = states.get(root);
    if (!state) return;
    if(options.resetHeadMotion===true)resetIdleHeadMotion(state.idleHeadMotion,true); // Explicit editor seek, not ordinary neutral frames.
    if (options.progress === 0 || options.attacking !== true && state.attacking) {
      state.angularVelocity.set(0, 0, 0); state.hasPhysicsVelocity = false; // Reset attack replay without carrying momentum from a different timeline.
      if (options.progress === 0) { state.direction.set(0, -1, 0); state.hasPivot = false; }
    }
    state.attacking = options.attacking === true;
    state.progress = Number.isFinite(options.progress) ? Math.max(0, Math.min(1, options.progress)) : 0;
    state.wf = Number.isFinite(options.windupFrac) ? Math.max(0, Math.min(1, options.windupFrac)) : 0.16;
    state.sf = Number.isFinite(options.strikeFrac) ? Math.max(state.wf, Math.min(1, options.strikeFrac)) : 0.28;
    state.hf = Number.isFinite(options.holdFrac) ? Math.max(state.sf, Math.min(1, options.holdFrac)) : 0.68;
    state.pitchTravelRad = Number.isFinite(options.pitchTravelDeg) ? options.pitchTravelDeg * Math.PI / 180 : null; // Authored strike-minus-windup pitch remains deterministic during editor scrubbing.
    state.yawTravelRad = Number.isFinite(options.yawTravelDeg) ? options.yawTravelDeg * Math.PI / 180 : 0; // Authored travel remains diagnostic; physical follow-through uses the measured world motion.
    state.cameraPosition = options.cameraPosition || null; // Standalone editor camera, if supplied.
    state.movementRoot = options.movementRoot || null; // Editor body frame; gameplay can identify the player from its existing movement position.
    state.movementPosition = options.movementPosition || null; // Player/NPC world position excludes hand-motion offsets from neutral-to-windup lag.
    state.fishingFlailHeadSpin = !!state.config.flail && state.attacking && options.fishingFlailHeadSpin === true; // The flexible head alone spins; normal flail strikes and NPC pendulums are unaffected.
    state.fishingFlailSpinRevolutions = Number.isFinite(Number(options.fishingFlailSpinRevolutions))
      ? Math.max(0, Number(options.fishingFlailSpinRevolutions)) : 2.5; // Matches the authored spinning-throw revolution count, not the ring project's pixel speed.
    state.hasExplicitFlailScale = options.flailLengthScale != null; // NPCs and editors pass their own sampled pose; cached player tools read the weapon-stance runtime.
    if (state.hasExplicitFlailScale) state.flailLengthScale = global.SharedAttackPose?.validFlailLength?.(options.flailLengthScale) ?? 1;
  }

  // Each visible duplicate owns its rope/head artwork, but the original weapon
  // supplies ONE shared world-space pendulum direction. Per-hand contact points
  // and head placements remain independent under each weapon's baked transform.
  // The original stays visible until BOTH async replicas have their connector and head.
  function syncDualWield(sourceRoot, mainMesh, offMesh, active, mirrorOffhand=false) {
    const source = states.get(sourceRoot);
    const replicas = [mainMesh, offMesh].filter(Boolean); // Live duplicate weapon meshes, one per anatomical hand.
    const readySource = !!(source?.config.flail && source.chain && source.headRoot);
    if (active && readySource) {
      for (const copy of replicas) {
        if (!states.has(copy)) {
          copy.userData.toolPlane = copy; // The copy's actual baked weapon plane is its own assembly root.
          decorate(copy, source.itemKey, { weaponAssembly: { flail: source.config.flail } }, {
            ...source.originalOptions, THREE: source.THREE,
            metalOptions: source.metalOptions, masteryLevel: source.masteryLevel,
          });
        }
        const replica = states.get(copy); // Visible side-specific art; only the source owns time-stepped pendulum physics.
        if (replica) {
          replica.mirroredFlail = mirrorOffhand&&copy===offMesh?states.get(mainMesh):null; // Reuse the main copy's solved joint transforms.
          replica.dualPhysicsSource = source; // Every swing copies this one authoritative WORLD-space direction, never a local-space angle.
          replica.attacking = source.attacking; replica.progress = source.progress;
          replica.fishingFlailHeadSpin=source.fishingFlailHeadSpin;replica.fishingFlailSpinRevolutions=source.fishingFlailSpinRevolutions; // Shared attack phase, including special fishing throws.
          replica.flailLengthScale = source.flailLengthScale; // Each duplicate has its own visual connector but shares the source pose's reach.
          replica.wf = source.wf; replica.sf = source.sf; replica.hf = source.hf;
          replica.pitchTravelRad = source.pitchTravelRad; replica.yawTravelRad = source.yawTravelRad;
          replica.cameraPosition=source.cameraPosition;
          replica.movementPosition = source.movementPosition; // One actor supplies locomotion; each replica still resolves its own pivot.
        }
      }
    } else {
      for (const copy of replicas) if (states.has(copy)) drop(copy); // No invisible per-frame pendulums after leaving dual wield.
    }
    const ready = active && readySource && replicas.length === 2
      && replicas.every(copy => !!(states.get(copy)?.chain && states.get(copy)?.headRoot));
    if (source?.chain && source?.headRoot) {
      if (ready && !source.dualWieldHidden) {
        source.preDualVisibility = { chain: source.chain.visible !== false, head: source.headRoot.visible !== false }; // Preserve independently hidden authored pieces.
      }
      if (ready) {
        source.chain.visible = false; source.headRoot.visible = false; // Hide only the flexible ORIGINAL, not the rigid copies.
      } else if (source.dualWieldHidden) {
        source.chain.visible = source.preDualVisibility?.chain ?? true;
        source.headRoot.visible = source.preDualVisibility?.head ?? true;
        source.preDualVisibility = null;
      }
      const justRestored = source.dualWieldHidden && !ready; // Reposition a previously hidden rope immediately after exiting dual wield.
      source.dualWieldHidden = ready; // Mobile diagnostics and enchantment routing use the same actual readiness.
      source.dualWieldReplicas = ready ? replicas : null; // Visible head metal targets must follow these two independent assemblies.
      if (justRestored && source.root.parent) updateOne(source, 0, performance.now(), 0); // One pose projection, no extra physics step or snap from an old hidden position.
    }
    return ready;
  }

  function ropeSpriteSizing(spec, unit, aspect) {
    const lengthPx = Math.max(2, Math.min(2048, Number(spec.lengthPx) || 160)); // The existing virtual endpoints use handle-image pixels.
    const radiusPx = Math.max(0.25, Math.min(30, Number(spec.radiusPx) || 2.5)); // Preserves the former rope cylinder's radius.
    const scaleX = connectorAxisScale(spec, 'scaleX'); // Width adjustment stays independent of reach.
    const scaleY = connectorAxisScale(spec, 'scaleY'); // Reach adjustment stays independent of width.
    return {
      length: lengthPx * unit, // Local sprite height before the uniform carrier scale.
      widthScale: 2 * radiusPx * unit / aspect * (scaleX / scaleY), // Normalize the PNG's native aspect and compensate for the carrier's Y scale.
      lengthPx: lengthPx * scaleY, // Final grip-to-head span in original handle pixels, before tool-size scaling.
      diameterPx: 2 * radiusPx * scaleX, // Final apparent thickness in original handle pixels.
    };
  }

  function ropeOpaqueBounds(image) {
    if (ropeSpriteBounds.has(image)) return ropeSpriteBounds.get(image);
    const width = image?.naturalWidth || image?.width, height = image?.naturalHeight || image?.height;
    let bounds = { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 }; // Full-image fallback if the browser refuses pixel reads.
    try {
      const canvas = document.createElement('canvas'); // Reads only the shared rope PNG once, not every frame.
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        context.drawImage(image, 0, 0);
        const rgba = context.getImageData(0, 0, width, height).data;
        let minX = width, minY = height, maxX = -1, maxY = -1; // Opaque silhouette used to align the visible rope with its physical tips.
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (rgba[(y * width + x) * 4 + 3] < 9) continue; // Matches the ruin renderer's alphaTest of 0.035.
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        }
        if (maxX >= minX && maxY >= minY) bounds = { minX, minY, maxX, maxY };
      }
    } catch (error) { report('Ruin rope alpha scan unavailable: ' + (error?.message || error)); }
    ropeSpriteBounds.set(image, bounds); // Subsequent actors reuse the exact bounds without another canvas read.
    return bounds;
  }

  function tintRopePixels(rgba, hex) {
    const color = String(hex || '').toUpperCase(); // Validated authored target for the same ColorFill shade-fill used by Gar-wolf coats.
    if (!/^#[0-9A-F]{6}$/.test(color) || color === '#FFFFFF') return rgba;
    const fill = global.ColorFill?.shadeFillPixels; // Canonical animal/NPC shade-fill, not a second flail-only recolor algorithm.
    if (typeof fill !== 'function') throw new Error('ColorFill.shadeFillPixels unavailable for flail rope');
    const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16)); // Original warm-brown target channels for the shared fill.
    fill(rgba, rgb, { debugLabel: 'weapon-rope:' + color }); // Auto-reference uses original PNG's brightest eligible region, as with unmasked animal patterns.
    return rgba; // ColorFill preserves alpha, near-white details and the native dark windings.
  }

  function tintedRopeTexture(THREE, sourceTexture, hex) {
    const image = sourceTexture?.image; // Original, still-white-material ruin PNG; never recolor the shared texture in place.
    const color = /^#[0-9a-f]{6}$/i.test(String(hex)) ? hex.toUpperCase() : '#FFFFFF';
    if (!image || color === '#FFFFFF') return sourceTexture;
    let variants = tintedRopeTextures.get(image);
    if (!variants) { variants = new Map(); tintedRopeTextures.set(image, variants); }
    if (variants.has(color)) {
      const cached = variants.get(color); // Recent artist colors stay resident; old swatches are recycled first.
      variants.delete(color); variants.set(color, cached);
      return cached;
    }
    try {
      const canvas = document.createElement('canvas'); // Paint once per image/tint; weapon instances only clone the result.
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      tintRopePixels(pixels.data, color);
      ctx.putImageData(pixels, 0, 0);
      const recolored = new THREE.CanvasTexture(canvas); // Preserves the full PNG and its alpha; makeRope applies the same visible-alpha crop.
      recolored.encoding = THREE.sRGBEncoding;
      recolored.generateMipmaps = false;
      recolored.minFilter = recolored.magFilter = THREE.LinearFilter;
      recolored.needsUpdate = true;
      variants.set(color, recolored);
      while (variants.size > ROPE_TINT_CACHE_LIMIT) {
        const oldest = variants.keys().next().value; // LRU eviction affects only cached templates, never currently rendered flail clones.
        const stale = variants.get(oldest);
        variants.delete(oldest);
        stale?.dispose?.();
      }
      return recolored;
    } catch (error) {
      report('Ruin rope recolor unavailable: ' + (error?.message || error)); // Existing mobile log explains missing color without blocking the weapon.
      return sourceTexture;
    }
  }

  function makeRope(THREE, spec, unit, renderOrder, sourceTexture) {
    const image = sourceTexture?.image; // The full ruin sprite supplies the physical camera-facing strip.
    const width = image?.naturalWidth || image?.width, height = image?.naturalHeight || image?.height;
    if (!(width > 0 && height > 0)) throw new Error('Ruin rope PNG has no dimensions');
    const opaque = ropeOpaqueBounds(image); // Crop the sprite's transparent margins, so both visible tips land exactly on the existing rope endpoints.
    const visibleWidth = opaque.maxX - opaque.minX + 1, visibleHeight = opaque.maxY - opaque.minY + 1;
    const aspect = visibleWidth / visibleHeight; // Keep the opaque silhouette rather than the 152 × 2164 canvas dimensions.
    const sizing = ropeSpriteSizing(spec, unit, aspect); // Same final visible reach and diameter as the former generated cylinder.
    const tintedSource = tintedRopeTexture(THREE, sourceTexture, spec.color); // Reuses the exact Gar-wolf color fill, rather than a private luminance formula.
    const map = tintedSource.clone(); // Each flail owns only its clone, preserving the cached tinted source across actors.
    map.offset.set(opaque.minX / width, 1 - (opaque.maxY + 1) / height); // Plane UVs have bottom-left origin, whereas ImageData rows begin at the top.
    map.repeat.set(visibleWidth / width, visibleHeight / height); // No tiling: one full opaque rope from grip to head.
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    map.encoding = THREE.sRGBEncoding;
    map.minFilter = map.magFilter = THREE.LinearFilter; // Match the ruin rope's original full-resolution TextureLoader filtering.
    map.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({
      map, color: '#FFFFFF', side: THREE.DoubleSide, // Pixel colors are already adjusted; do not multiply the whole shaded PNG again.
      transparent: true, alphaTest: 0.35, depthWrite: true, toneMapped: false, // Match the game's solid PNG depth mask; thin fringes never write foreground depth.
    }); // Same unlit, transparent, double-sided rendering as DungeonRopeArt.
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(aspect, 1), material);
    mesh.name = 'flail_ruin_rope_sprite';
    mesh.scale.set(sizing.widthScale, sizing.length, 1);
    mesh.renderOrder = renderOrder;
    mesh.userData.hobunjiWeaponAssemblyPart = true;
    mesh.userData.hobunjiHeldObjectPlane = true; // Keep existing held-weapon draw ordering.
    mesh.userData.hobunjiGeneratedRope = true; // Tool Hub frames the actual plane bounds, not a PNG's blank margins.
    mesh.userData.dungeonRopeSprite = spec.sprite || 'assets/objectsprites/rope_long.png'; // Mobile diagnostics identify the art source.
    mesh.userData.ropeTintMethod = tintedSource === sourceTexture ? 'source-fallback' : 'ColorFill.shadeFillPixels'; // Distinguishes a successful animal shade-fill from a silently uncolored source on mobile.
    mesh.userData.noOutline = true; // The rope PNG already carries its outline artwork.
    const group = new THREE.Group(); // Reuses the current pendulum carrier and grip/head positioning.
    group.name = 'flail_ruin_rope';
    group.userData.hobunjiRuinRopeSprite = true; // Uniform world scale avoids skewing the camera-facing ribbon.
    group.add(mesh);
    const cameraPosition = new THREE.Vector3(); // Render-time camera position relative to this rope carrier.
    const normal = new THREE.Vector3(); // Direction to camera, projected perpendicular to the rope axis.
    const right = new THREE.Vector3(); // Horizontal basis for the camera-facing rope PNG.
    const up = new THREE.Vector3(0, 1, 0); // The carrier's local Y remains the taut suspension axis.
    const basis = new THREE.Matrix4(); // Reused to orient the plane without allocations per frame.
    const inverseWorld = new THREE.Matrix4(); // Uses the rendered carrier matrix directly, avoiding a holder-pose recomputation during onBeforeRender.
    const previousCarrier = new THREE.Matrix4(); // Exact world-matrix key across base/depth/outline replays.
    const previousCamera = new THREE.Vector3();
    const previousFacing = new THREE.Quaternion();
    let facingReady = false;
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      if (!camera?.getWorldPosition) return;
      // The renderer already updated the actual camera matrix for this pass.
      if (camera.matrixWorld?.elements) cameraPosition.setFromMatrixPosition(camera.matrixWorld);
      else camera.getWorldPosition(cameraPosition);
      if (facingReady && previousCarrier.equals(group.matrixWorld) && previousCamera.equals(cameraPosition)
          && previousFacing.equals(mesh.quaternion)) {
        mesh.userData.ropeFacingReuses = (mesh.userData.ropeFacingReuses || 0) + 1;
        // Local position/scale or a replay hook may have changed the leaf
        // matrix even though its required facing is unchanged. Refresh it
        // exactly as the uncached path does, without rebuilding the basis.
        mesh.updateMatrixWorld();
        return;
      }
      previousCarrier.copy(group.matrixWorld);
      previousCamera.copy(cameraPosition);
      cameraPosition.applyMatrix4(inverseWorld.copy(group.matrixWorld).invert()); // Match the ruin rope billboard without recomputing the game's baked tool-holder pose.
      normal.set(cameraPosition.x, 0, cameraPosition.z);
      if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1);
      normal.normalize();
      right.crossVectors(up, normal).normalize();
      normal.crossVectors(right, up).normalize();
      mesh.quaternion.setFromRotationMatrix(basis.makeBasis(right, up, normal));
      mesh.updateMatrixWorld(); // Face the actual rendering camera, including Tool Hub/attack preview cameras.
      previousFacing.copy(mesh.quaternion);
      facingReady = true;
      mesh.userData.ropeFacingUpdates = (mesh.userData.ropeFacingUpdates || 0) + 1;
    };
    return group; // The grapple head replaces the ruin rope's brush-shaped grip tip.
  }

  function relativePartScale(part) {
    const n = Number(part?.scale ?? 1); // Reads the Tool Hub's chain/head scale in handle-relative units (1 = identical proportional scale).
    return Number.isFinite(n) ? Math.max(0.05, Math.min(8, n)) : 1;
  }

  function connectorAxisScale(part, axis) {
    const n = Number(part?.[axis] ?? part?.scale ?? 1); // Resolves independent connector size, falling back to legacy uniform drafts.
    return Number.isFinite(n) ? Math.max(0.05, Math.min(8, n)) : 1;
  }

  function flailStrikeStraightening(progress, windupFrac, strikeFrac) {
    if (progress <= windupFrac) return 0; // Neutral → Windup is gravity-only (plus locomotion lag).
    const strikeSpan = Math.max(0.0001, strikeFrac - windupFrac);
    const t = Math.max(0, Math.min(1, (progress - windupFrac) / (strikeSpan * 0.35))); // Straighten in the first 35% of Windup → Strike.
    return t * t * (3 - 2 * t); // Gradual contact with the animated shaft; exactly aligned for the rest of strike.
  }

  function fishingFlailHeadDirection(out, shaftUp, planeNormal, progress, revolutions, workQ) {
    const t = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0; // Current fishing throw phase, shared by the grip and the moving head.
    const turns = Number.isFinite(revolutions) ? Math.max(0, revolutions) : 2.5; // Existing Spin Throw revolutions; zero means hold the head at its shaft-aligned start.
    workQ.setFromAxisAngle(planeNormal, -Math.PI * 2 * turns * t); // Spin in the actual baked shaft plane, never the camera/screen plane.
    return out.copy(shaftUp).applyQuaternion(workQ).normalize(); // Caller-owned direction; shaft and physical connector length remain unchanged.
  }

  function flailYawTravel(windup, strike, power = 1, dirSign = 1) {
    if (!windup || !strike) return 0;
    return (((Number(strike.yaw) || 0) - (Number(windup.yaw) || 0))
      + ((Number(strike.bodyYaw) || 0) - (Number(windup.bodyYaw) || 0))) * power * dirSign;
  }

  function flailDamping(motion) {
    const value = motion?.angularDamping; // Per-weapon drag is exported by the assembler and read during every physical step.
    return Number.isFinite(value) ? Math.max(0, Math.min(30, value)) : 8;
  }

  // A point-mass head on a taut, massless connector: I = m L² and
  // torque = m L (direction × (gravity - pivotAcceleration)), so mass cancels.
  // Small fixed substeps integrate angular momentum without prescribing an angle.
  function stepPendulum(body, acceleration, length, dt, gravity = 9.81, damping = 8) {
    if (!(dt > 0) || !Number.isFinite(dt) || !(length > 0) || !Number.isFinite(length)) return;
    const d = body.direction, w = body.angularVelocity; // Mutated per-instance direction and angular velocity; no frame allocations.
    const steps = Math.ceil(Math.min(MAX_DT, dt) * 240), h = Math.min(MAX_DT, dt) / steps; // At most 20 substeps per render frame.
    const ax = -acceleration.x, ay = -gravity - acceleration.y, az = -acceleration.z; // Effective gravity in the accelerating pivot frame.
    // Exact equilibrium only: a hanging, motionless connector with no
    // sideways acceleration has zero torque at every substep. No epsilon,
    // sleep threshold or reduced physical update rate.
    if (w.x === 0 && w.y === 0 && w.z === 0 && Number.isFinite(damping) && Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(az)
        && d.y*az-d.z*ay === 0 && d.z*ax-d.x*az === 0 && d.x*ay-d.y*ax === 0) {
      if (typeof body.equilibriumSkips === 'number') body.equilibriumSkips += steps;
      return;
    }
    const decay = Math.exp(-Math.max(0, damping) * h); // Mild air/bearing loss expressed per second, independent of frame rate.
    for (let i = 0; i < steps; i++) { // Kick/rotate/kick preserves free rotation and the exact connector length.
      w.x += (d.y * az - d.z * ay) * h / (2 * length);
      w.y += (d.z * ax - d.x * az) * h / (2 * length);
      w.z += (d.x * ay - d.y * ax) * h / (2 * length);
      const speed = Math.hypot(w.x, w.y, w.z); // Angular speed determines this substep's physical rotation.
      if (speed > 1e-10) {
        const x = w.x / speed, y = w.y / speed, z = w.z / speed; // Rotation axis for Rodrigues' formula.
        const c = Math.cos(speed * h), sn = Math.sin(speed * h), dot = x * d.x + y * d.y + z * d.z; // Exact spherical drift avoids velocity-dependent projection losses.
        const dx = d.x, dy = d.y, dz = d.z; // Preserve original components while rotating in place.
        d.x = dx * c + (y * dz - z * dy) * sn + x * dot * (1 - c);
        d.y = dy * c + (z * dx - x * dz) * sn + y * dot * (1 - c);
        d.z = dz * c + (x * dy - y * dx) * sn + z * dot * (1 - c);
      }
      w.x = (w.x + (d.y * az - d.z * ay) * h / (2 * length)) * decay;
      w.y = (w.y + (d.z * ax - d.x * az) * h / (2 * length)) * decay;
      w.z = (w.z + (d.x * ay - d.y * ax) * h / (2 * length)) * decay;
    }
  }

  // Holders can override updateMatrixWorld to bake a transient pose around the real
  // update (weapon-tool-stances.js applies the idle stance and cancels the sweep twist
  // there, then restores the raw local transform). Object3D.updateWorldMatrix() and the
  // getWorld*() helpers bypass that override and recompute from the raw local pose, so
  // an assembly using them attaches its rope to a haft that is not where the renderer
  // draws it. Refresh through the outermost overriding ancestor instead.
  function refreshWorldMatrix(object) {
    let hooked = null;
    for (let node = object; node; node = node.parent) {
      if (Object.prototype.hasOwnProperty.call(node, 'updateMatrixWorld')) hooked = node;
    }
    if (!hooked) { object.updateWorldMatrix(true, false); return; }
    hooked.parent?.updateWorldMatrix(true, false);
    hooked.updateMatrixWorld(true);
  }

  function isCachedPlayerToolRoot(root) {
    // Read-only ownership diagnostics: the actual assembly lifetime follows
    // its root's references, never a slot map or a fixed detachment timeout.
    if (!root) return false;
    if (global.EquipmentPanel?.ownsCachedToolRoot?.(root)) return true;
    for (const deps of [global.ProceduralHandAttachments?.gameDeps, global.Combat?.deps]) {
      const map = deps?.toolMeshMap; // Optional adapters sometimes omit the authoritative equipment cache.
      if (!map) continue;
      const candidates = typeof map.values === 'function' ? map.values() : Object.values(map);
      for (const visual of candidates) if (visual === root) return true;
    }
    return false;
  }

  // localToWorld/worldToLocal call updateWorldMatrix internally and can erase a
  // transient authored stance. Apply cached matrixWorld values only, including
  // their rotation and scale, so offset flail anchors remain in haft-local space.
  function bakedPoint(point, from, into, inverse, result) {
    result.copy(point);
    if (from) result.applyMatrix4(from.matrixWorld);
    if (into) result.applyMatrix4(inverse.copy(into.matrixWorld).invert());
    return result;
  }

  // The haft may inherit separate species X/Y rig scales. A flexible part must
  // remain world-oriented while matching its LONG (local Y) dimension; composing
  // its world pose and multiplying by the exact inverse holder matrix cancels
  // body anisotropy without shearing the rope or head or changing authored ratios.
  function placeFlexiblePartWorld(part, inverseRootWorld, position, rotation, scale, worldMatrix) {
    worldMatrix.compose(position, rotation, scale);
    part.matrix.copy(inverseRootWorld).multiply(worldMatrix);
    part.matrixAutoUpdate = false; // A subsequent parent update must not replace the corrected matrix with a decomposed local TRS.
    part.matrixWorldNeedsUpdate = true;
  }

  // Idle head artwork stays world-up. Measure the vertical offset from its
  // rope attachment to its authored contact edge, or all layer bounds.
  function idleHeadContact(state,unit,profile) {
    const head=state.config.flail.head,visual=head.visualTransform;
    const cached=state.groundHeadContact; // Head geometry is static under its moving suspension; alpha trace only when image/geometry changes.
    if(cached?.profile===profile&&cached.unit===unit&&cached.parts.length===state.headParts.length
      &&state.headParts.every((p,i)=>p.geometry===cached.parts[i].geometry&&p.material?.map?.image===cached.parts[i].image))return cached.result;
    const index=Math.max(0,head.layers.findIndex(l=>l.id===head.anchorLayer));
    const mesh=state.headParts[index];
    if(!mesh)return null;
    const sx=visual?(Number(visual.scaleX)||1)*(visual.flipX?-1:1):1;
    const sy=visual?(Number(visual.scaleY)||1)*(visual.flipY?-1:1):1;
    const theta=-(Number(visual?.rotation)||0)*Math.PI/180;
    const c=Math.cos(theta),s=Math.sin(theta);
    const ty=(x,y)=>s*x*sx+c*y*sy;
    const tx=(x,y)=>c*x*sx-s*y*sy;
    const a=head.anchorSpace==='composite'?state.scratch.headAnchorLocal.set(state.headAnchor.x*unit,-state.headAnchor.y*unit,0)
      :pixelPoint(state.headAnchorImage,state.headAnchor,unit,head.layers[index]?.offsetPx,state.scratch.headAnchorLocal);
    const anchorY=ty(a.x,a.y);
    const anchorX=tx(a.x,a.y),dx=(Number(visual?.x)||0)*unit,dy=(Number(visual?.y)||0)*unit;
    let lower=Infinity,minX=Infinity,maxX=-Infinity,maxY=-Infinity;
    const include=(x,y)=>{const xx=tx(x,y)-anchorX+dx,yy=ty(x,y)-anchorY-dy;minX=Math.min(minX,xx);maxX=Math.max(maxX,xx);maxY=Math.max(maxY,yy);lower=Math.min(lower,ty(x,y));}; // Cached contact-relative transformed bounds.
    const auto=state.headParts.map(part=>{
      if(!part.geometry.boundingBox)part.geometry.computeBoundingBox();
      return global.HeldGroundPose?.autoContact?.(part.material?.map?.image,part.geometry.boundingBox,[]);
    });
    const traced=auto.every(points=>points?.length>0);
    const authored=!traced&&!!profile.headContact;
    if(traced){
      for(let i=0;i<state.headParts.length;i++){
        const part=state.headParts[i];
        for(const p of auto[i])include(part.position.x+p.x,part.position.y-p.z);
      }
    }else if(authored) {
      if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
      const b=mesh.geometry.boundingBox;
      for(const p of profile.headContact)include(mesh.position.x+b.min.x+p.u*(b.max.x-b.min.x),mesh.position.y+b.max.y-p.v*(b.max.y-b.min.y));
    }else for(const part of state.headParts) {
      if(!part.geometry.boundingBox)part.geometry.computeBoundingBox();
      const b=part.geometry.boundingBox;
      for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])include(part.position.x+x,part.position.y+y);
    }
    const drop=anchorY-lower+(Number(visual?.y)||0)*unit;
    const result=Number.isFinite(drop)?{drop,minX,maxX,maxY,authored,traced}:null;
    state.groundHeadContact={profile,unit,parts:state.headParts.map(p=>({geometry:p.geometry,image:p.material?.map?.image})),result};
    return result;
  }

  function tiltedHeadDrop(contact,quat) {
    const x=2*(quat.x*quat.y+quat.w*quat.z),y=1-2*(quat.x*quat.x+quat.z*quat.z); // World-Y row, applied to cached contact-relative bounds.
    return -(x*(x<0?contact.maxX:contact.minX)+y*(y<0?contact.maxY:-contact.drop));
  }

  // Read the authored physical connector and head from this exact assembly.
  // Called only while a permanent Light fit is still pending.
  function groundFitSpec(root,profile) {
    const state=states.get(root),f=state?.config?.flail;
    if(!f||!state.chain||!state.headRoot||!state.chainTop||!state.chainBottom||!state.headAnchor)return null;
    const plane=state.plane,image=plane.material?.map?.image;
    const width=image?.naturalWidth||image?.width;
    if(!(width>0))return null;
    const unit=(plane.geometry?.parameters?.width||.5)/width;
    if(state.baseAnchorImage!==image){state.baseAnchor=anchor(image,f.haftAnchor,'top');state.baseAnchorImage=image;}
    if(!state.baseAnchor)return null;
    const contact=idleHeadContact(state,unit,profile);
    if(!contact?.traced)return null; // Never freeze a physical fit against transparent texture bounds.
    const p=pixelPoint(image,state.baseAnchor,unit,null,state.scratch.pivotLocal);
    const spanX=(state.chainBottom.x-state.chainTop.x)*unit*connectorAxisScale(f.chain,'scaleX');
    let spanY=(state.chainBottom.y-state.chainTop.y)*unit*connectorAxisScale(f.chain,'scaleY');
    const mount=Number(f.chain.mountLengthPx);
    if(!state.chain.userData?.hobunjiRuinRopeSprite&&Number.isFinite(mount)&&mount>0&&Math.abs(spanY)>1e-8)
      spanY=Math.sign(spanY)*Math.sqrt(Math.max(1e-8,(mount*unit)**2-spanX**2));
    return {x:p.x,y:p.y,spanX,spanY,headDrop:contact.drop*relativePartScale(f.head)};
  }

  // Direction of a connector that the floor forces to trail. The horizontal
  // heading follows the actor's travel only while it is actually moving; once it
  // stops, the last heading is kept instead of falling back to a fixed angle (the
  // haft's up-vector or +Z), and the pendulum direction eases toward it instead of
  // snapping. The vertical component is never allowed below the floor-safe value.
  function resolveTrailingDirection(state, velocityX, velocityZ, shaftX, shaftZ, solveY, dt, restX=0, restZ=0) {
    const heading = state.trailHeading || (state.trailHeading = { x: 0, z: 0, valid: false });
    const direction = state.direction;
    const speedSq = velocityX * velocityX + velocityZ * velocityZ;
    if (Number.isFinite(speedSq) && speedSq > HEAD_MOVE_EPSILON * HEAD_MOVE_EPSILON) {
      const speed = Math.sqrt(speedSq);
      heading.x = -velocityX / speed; heading.z = -velocityZ / speed; heading.valid = true; // Dragged behind the travel direction.
    } else if (restX*restX+restZ*restZ>1e-8 && dt>0) {
      const length=Math.hypot(restX,restZ); // Both idle hands settle toward the actor's rear.
      heading.x=restX/length;heading.z=restZ/length;heading.valid=true;
    } else if (!heading.valid) {
      let x = direction.x, z = direction.z; // First contact while already standing: the pendulum's own lean, then the haft.
      if (x * x + z * z < 1e-8) { x = shaftX; z = shaftZ; }
      if (x * x + z * z < 1e-8) { x = 0; z = 1; }
      const length = Math.hypot(x, z);
      heading.x = x / length; heading.z = z / length; heading.valid = true;
    }
    const horizontal = Math.sqrt(Math.max(0, 1 - solveY * solveY));
    const blend = dt > 0 ? 1 - Math.exp(-HEAD_SETTLE_RATE * dt) : 0; // Frozen physics never moves the rope.
    let x = direction.x + (heading.x * horizontal - direction.x) * blend;
    let y = direction.y + (solveY - direction.y) * blend;
    let z = direction.z + (heading.z * horizontal - direction.z) * blend;
    if (y < solveY) y = solveY; // Easing may not dip the head through the floor-safe direction.
    const flat = Math.hypot(x, z), want = Math.sqrt(Math.max(0, 1 - y * y));
    if (flat > 1e-8) { x *= want / flat; z *= want / flat; }
    else { x = heading.x * want; z = heading.z * want; }
    direction.set(x, y, z);
    return direction;
  }

  function updateOne(state, dt, now, effectsDt = dt) {
    const { root, plane, config, scratch: q } = state;
    if (!root.parent) {
      if (!state.detachedAt) {
        state.detachedAt = now;
        state.hasPivot = false; // Re-equipping resets old idle momentum rather than launching the suspended head.
        state.hasMovementPosition=false;state.turnRoot=null;state.turnYaw=null;state.turnRate=0;
        resetIdleHeadMotion(state.idleHeadMotion);
        state.hasPhysicsVelocity = false;
        state.angularVelocity.set(0, 0, 0);
      }
      // Parent removal does not imply disposal: the player (and preview tools)
      // can retain this exact handle for arbitrarily long without a visible parent.
      // Lifetime follows the root's real owner; weak registry entries never pin discarded roots.
      return;
    }
    state.detachedAt = 0;
    if (state.chain && state.chain.parent !== root) { root.add(state.chain); state.repairedParts++; } // Self-heal an external cleanup/reparent operation on next equipped frame.
    if (state.headRoot && state.headRoot.parent !== root) { root.add(state.headRoot); state.repairedParts++; } // Preserve all authored head layers and their current textures.
    if (!state.chain || !state.headRoot) {
      if (root.visible !== false && state.fireEmitters?.length) {
        if (state.fireEmitters.some(fx => fx.worldRise)) refreshWorldMatrix(plane); // Keep torch flames on the baked tip rather than the holder's transient raw rotation.
        for (const fx of state.fireEmitters) fx.group.updateMatrixWorld(true);
        effects?.stepFire(state, effectsDt);
      } // Ordinary multi-layer tools can have interleaved VFX without a chain.
      return;
    }
    // Use the final holder+plane world pose, including the game's transient
    // authored Neutral. The rigid haft never relinquishes animation authority.
    refreshWorldMatrix(plane); // Same baked holder frame the renderer will draw, not the raw local pose.
    const mirror=state.mirroredFlail;
    if(mirror?.chain&&mirror.headRoot){
      // The offhand root already reflects the main root. Identical local joints reflect the entire assembly.
      for(let i=0;i<2;i++){
        const from=i?mirror.headRoot:mirror.chain;
        const part=i?state.headRoot:state.chain;
        part.matrixAutoUpdate=false;
        part.matrix.copy(from.matrix);
        part.matrixWorldNeedsUpdate=true;
        part.updateMatrixWorld(true);
      }
      state.groundClearance=mirror.groundClearance;
      if(root.visible!==false)effects?.stepFire(state,effectsDt);
      return;
    }
    const baseImage = plane.material?.map?.image;
    if (!baseImage) return;
    const unit = (plane.geometry?.parameters?.width || 0.5) / (baseImage.naturalWidth || baseImage.width || 1);
    const flail = config.flail;
    if (state.baseAnchorImage !== baseImage) {
      state.baseAnchor = anchor(baseImage, flail.haftAnchor, 'top');
      state.baseAnchorImage = baseImage; // Re-scan only when an edited/recolored haft changes its source image.
    }
    if (!state.baseAnchor || !state.chainTop || !state.chainBottom || !state.headAnchor) return;
    pixelPoint(baseImage,state.baseAnchor,unit,null,q.pivotLocal);
    global.HeldGroundPose?.adjustHaftPoint?.(plane,q.pivotLocal);
    const pivot = bakedPoint(q.pivotLocal, plane, null, q.inverseRootMatrix, q.pivot); // Baked local Y offset rotates with its own haft.
    plane.matrixWorld.decompose(q.decomposePos, q.baseQ, q.scale); // Rotation and rendered world scale from the baked matrix (getWorldQuaternion/getWorldScale bypass holder hooks).
    const baseQ = q.baseQ;
    const normal = q.normal.set(0, 0, 1).applyQuaternion(baseQ);
    // q.scale (above) is the current haft's rendered world scale, including pre-existing grips, stances and item-size modifiers.
    root.matrixWorld.decompose(q.decomposePos, q.rootWorldQ, q.rootScale); // Both child parts live under root, not under the transformed haft plane.
    const attachmentScale = Math.max(0.00001, Math.abs(q.scale.y)); // The haft's long local Y axis is the source of species/character-height weapon sizing, not its X width.
    state.renderedHaftLongScale = attachmentScale; state.renderedHaftWidthScale = Math.abs(q.scale.x); // Console-free scaling diagnosis for the currently equipped species.
    const localHandleScale = attachmentScale / Math.max(0.00001, Math.abs(q.rootScale.x)); // Compensates for extra scale applied to the handle plane itself.
    if (state.dualPhysicsSource) state.flailLengthScale = state.dualPhysicsSource.flailLengthScale; // Both hands follow the same sampled attack length as their original.
    else if (!state.hasExplicitFlailScale) {
      state.flailLengthScale = 1; // A preview or unequipped actor with no authored channel must not retain the last weapon's shortened reach.
      if (isCachedPlayerToolRoot(root)) {
        const runtime = global.WeaponToolStances?.getRuntimeState?.(); // Only cached player flails borrow the weapon slot's live neutral/attack pose.
        if (runtime?.activeSlot === 'weapon' && runtime.itemKey === state.itemKey) {
          state.flailLengthScale = global.SharedAttackPose?.validFlailLength?.(runtime.flailLengthScale) ?? 1;
        }
      }
    }
    const chainScaleX = connectorAxisScale(flail.chain, 'scaleX'); // Chain width or generated-rope radius relative to the final rendered handle.
    let chainScaleY = connectorAxisScale(flail.chain, 'scaleY'); // Reach uses Y only; head size and connector width stay independently authored.
    const mountLength = Number(flail.chain.mountLengthPx); // Rope-mount line length, expressed in unchanged source-haft pixels.
    if (!state.chain.userData?.hobunjiRuinRopeSprite && Number.isFinite(mountLength) && mountLength > 0) {
      const spanX = (state.chainBottom.x - state.chainTop.x) * chainScaleX;
      const spanY = Math.abs(state.chainBottom.y - state.chainTop.y);
      if (spanY > 1e-5) chainScaleY = Math.sqrt(Math.max(1e-8, mountLength * mountLength - spanX * spanX)) / spanY;
      // Original raster chain may be diagonal: preserve its X width/offset and solve only Y stretch for the desired span.
    }
    const authoredChainScaleY = chainScaleY; // Preserve the authored rope width even when a combat pose shortens its longitudinal reach.
    const headScale = relativePartScale(flail.head); // Head size is still independently handle-relative.
    const pose=global.HeldGroundPose;
    const sharedSource=state.dualPhysicsSource&&!state.dualPhysicsSource.dead?state.dualPhysicsSource:null; // Source owns permanent geometry and rope fit; visible hands own live clearance.
    const preview=pose?.previewAppliesTo?.(root)&&!sharedSource;
    const runtime=pose?.enabled?.()&&!sharedSource
      &&root.parent===global.ProceduralHandAttachments?.gameDeps?.toolHolder
      ?global.WeaponToolStances?.getRuntimeState?.():null;
    const profile=sharedSource?sharedSource.groundProfile:(preview||runtime?.activeSlot==='weapon'&&runtime.itemKey===state.itemKey
      ?global.HobunjiHandToolGrips?.groundProfileForTool?.(state.itemKey):null);
    state.groundProfile=profile; // No separate metadata lookup or mutable physical fit for the visible replicas.
    const floor=profile?pose.groundY():null; // No shortening limit means fixed rope length, NOT disabled ground contact.
    const contact=Number.isFinite(floor)&&!state.attacking?idleHeadContact(state,unit,profile):null;
    // Fixed Light fit uses upright contact; live trailing accounts for tilt separately.
    // Fit the connector in the neutral, vertically hanging reference pose, not
    // its transient pendulum direction. Reuse the physical fit on every frame.
    const spanX=(state.chainBottom.x-state.chainTop.x)*unit*chainScaleX;
    const spanY=(state.chainBottom.y-state.chainTop.y)*unit*chainScaleY;
    const baseLength=Math.hypot(spanX,spanY)*attachmentScale;
    const lightDrop=!sharedSource&&profile?.ropeMinScale!=null?pose.referenceDrop(root,q.pivotLocal):null; // Same immutable light stance reference as the haft.
    const canFit=!!contact?.traced&&Number.isFinite(lightDrop)&&!state.fishingFlailHeadSpin&&(preview||global.PlayerJump?.heldPoseGrounded?.()===true);
    const candidate=canFit?pose.ropeFitCandidate(spanX,spanY,attachmentScale,lightDrop-contact.drop*attachmentScale*headScale,profile.ropeMinScale,pose.lightRopeScale(root)):null;
    const fixedScale=sharedSource?(sharedSource.fixedRopeScale??1):(profile?.ropeMinScale!=null?pose.fittedRopeScale(root,profile,canFit,candidate):1);
    state.fixedRopeScale=fixedScale; // Both independently posed copies retain the canonical fitted rope length.
    const desiredLocal=baseLength*fixedScale/attachmentScale;
    if(fixedScale<1&&Math.abs(spanY)>1e-8)
      chainScaleY*=Math.max(0.00001,Math.sqrt(Math.max(0,desiredLocal*desiredLocal-spanX*spanX))/Math.abs(spanY));
    // Existing authored flail length animations are separate from the physical
    // fitted size; they may shorten further, but cannot exceed it.
    chainScaleY *= fixedScale<1?Math.min(1,state.flailLengthScale):state.flailLengthScale;
    if (state.chain.userData?.hobunjiRuinRopeSprite) {
      state.chain.scale.setScalar(localHandleScale * authoredChainScaleY); // Child width already compensates for both authoring axes; keep the billboard uniformly scaled.
    } else {
      state.chain.scale.set(
        localHandleScale * chainScaleX,
        localHandleScale * chainScaleY,
        localHandleScale * (state.chain.userData?.hobunjiGeneratedRope ? chainScaleX : 1),
      ); // Raster chains keep their authored width/length transform.
    }
    state.headRoot.scale.setScalar(localHandleScale * headScale);
    const topLocal = pixelPoint(state.chainImage, state.chainTop, unit, null, q.topLocal);
    const bottomLocal = pixelPoint(state.chainImage, state.chainBottom, unit, null, q.bottomLocal);
    topLocal.x *= chainScaleX; topLocal.y *= chainScaleY;
    bottomLocal.x *= chainScaleX; bottomLocal.y *= chainScaleY; // Contacts must use the same stretched coordinates as visible connector geometry.
    const chainSpan = q.span.copy(topLocal).sub(bottomLocal);
    if (chainSpan.lengthSq() < 1e-10) return; // Degenerate all-transparent/one-pixel chain cannot form a lever.
    state.physicsLength = Math.max(0.01, chainSpan.length() * attachmentScale); // World-space rope length supplies the pendulum lever arm.
    chainSpan.normalize();
    const shaftUp = q.shaftUp.set(0, -1, 0).applyQuaternion(baseQ).normalize(); // Each physical haft has its own fallback trailing direction.
    const sharedPhysics = sharedSource; // The original updates before its later-created visible copies in the shared frame scheduler.
    if (sharedPhysics) {
      state.direction.copy(sharedPhysics.direction); // Identical world-space sway; each side still uses its own baked haft attachment below.
      q.velocity.copy(sharedPhysics.scratch.velocity); // Shared actor movement for both visible copies.
      state.actorMotionValid=sharedPhysics.actorMotionValid;
    } else {
    q.measuredPivotVelocity.copy(pivot).sub(state.lastPivot).divideScalar(Math.max(0.001, dt)); // The animated attachment transfers real handle momentum.
    q.pivotAcceleration.copy(q.measuredPivotVelocity).sub(state.pivotVelocity).divideScalar(Math.max(0.001, dt));
    if (!state.hasPivot || pivot.distanceToSquared(state.lastPivot) > 9) {
      state.direction.set(0, -1, 0);
      state.angularVelocity.set(0, 0, 0); q.measuredPivotVelocity.set(0, 0, 0); state.hasPhysicsVelocity = false; // First observation and teleports cannot inject momentum.
      state.lastPivot.copy(pivot);
      state.hasPivot = true;
    }
    const actorPosition = state.movementPosition; // World-space locomotion supplied by game/preview, independent of the animated haft.
    const velocity = q.velocity;
    state.actorMotionValid=!!actorPosition&&Number.isFinite(actorPosition.x)&&Number.isFinite(actorPosition.y)&&Number.isFinite(actorPosition.z);
    if (state.actorMotionValid) {
      if (!state.hasMovementPosition || state.lastMovementPosition.distanceToSquared(actorPosition) > 9) {
        state.turnYaw=null;
        state.lastMovementPosition.copy(actorPosition); // Teleports / first observation must not whip the chain.
        state.hasMovementPosition = true;
      }
      if(dt>0){velocity.copy(actorPosition).sub(state.lastMovementPosition).divideScalar(Math.max(0.001, dt));state.lastMovementPosition.copy(actorPosition);}
      else velocity.set(0,0,0);
    } else {
      state.hasMovementPosition = false;
      velocity.copy(pivot).sub(state.lastPivot).divideScalar(Math.max(0.001, dt)); // Fallback for third-party holders lacking an actor position.
    }
    state.lastPivot.copy(pivot);
    if (!state.hasPhysicsVelocity) q.pivotAcceleration.set(0, 0, 0); // Ignore unknown velocity at initialization or after a seek.
    if (dt > 0) state.pivotVelocity.copy(q.measuredPivotVelocity);
    q.previousDirection.copy(state.direction); // Measure the driven connector velocity before release.
    const motion = flail.motion || {}; // Authored inertial controls from the Tool Hub; ordinary stances are not modified.
    const lag = Number.isFinite(Number(motion.lag)) ? Math.max(0, Math.min(1, Number(motion.lag))) : MOTION_LAG;
    const pitchAxis = q.pitchAxis.set(1, 0, 0).applyQuaternion(q.rootWorldQ).normalize(); // Use the holder frame: the PNG sweep basis rotates its local X away from the authored pitch axis.
    if (state.attacking && (!state.wasAttacking || state.progress < state.lastFrameProgress - 0.01)) {
      state.angularVelocity.set(0, 0, 0); state.hasPhysicsVelocity = false; q.pivotAcceleration.set(0, 0, 0);
      state.strikeTurnRad = 0; state.hasShaftUp = false; state.hasStrikeStart = false; // Reset the cached strike entry after a new attack or timeline seek.
    }
    if (state.attacking && state.hasShaftUp && state.progress > state.wf && state.progress <= state.sf) {
      const sine = q.pitchCross.crossVectors(state.lastShaftUp, shaftUp).dot(pitchAxis);
      const turn = Math.atan2(sine, Math.max(-1, Math.min(1, state.lastShaftUp.dot(shaftUp))));
      if (Math.abs(turn) < 0.5) state.strikeTurnRad += turn; // Observe pitch for procedural swings without explicit pose metadata.
    }
    state.lastShaftUp.copy(shaftUp); state.hasShaftUp = true;
    state.wasAttacking = state.attacking; state.lastFrameProgress = state.progress;
    if (state.fishingFlailHeadSpin) {
      // Keep the shaft, its primary-hand grip and pivot exactly where the existing throw pose put them.
      // Only orbit the direction of the connector/head around that real haft attachment, in the shaft's
      // baked PNG plane. The existing endpoint solver below keeps rope and head joined every frame.
      fishingFlailHeadDirection(state.direction, shaftUp, normal, state.progress, state.fishingFlailSpinRevolutions, q.deltaQ);
      state.angularVelocity.set(0, 0, 0); state.hasPhysicsVelocity = false; state.hasStrikeStart = false;
    } else if (!state.attacking) {
      // Idle suspension is a world-space pendulum: it hangs under gravity, swings
      // when the holder accelerates or turns, and settles instead of snapping to a pose.
      // The rigid grip and authored attack motion remain independent of the rope.
      stepPendulum(state, q.pivotAcceleration, state.physicsLength, dt, 9.81, flailDamping(motion));
      state.hasStrikeStart = false; // Every attack begins from the current idle suspension.
    } else if (state.progress <= state.wf) {
      const target = q.target.set(-velocity.x * lag, -1, -velocity.z * lag).normalize(); // Preserve the authored windup's gravity-and-locomotion lag.
      const turnAngle = state.direction.angleTo(target);
      if (turnAngle > 1e-6) {
        const maxTurn = Math.max(0, Math.min(MAX_DT, dt))
          * Math.max(0.1, Math.min(60, Number(motion.idleFollow) || 7));
        q.deltaQ.setFromUnitVectors(state.direction, target);
        q.stepQ.identity().slerp(q.deltaQ, Math.min(1, maxTurn / turnAngle));
        state.direction.applyQuaternion(q.stepQ).normalize();
      }
    } else if (state.progress < state.sf) {
      if (!state.hasStrikeStart) {
        state.strikeStartDirection.copy(state.direction); // Anchor the strike interpolation to the LAST windup gravity/locomotion state.
        state.hasStrikeStart = true;
      }
      const t = flailStrikeStraightening(state.progress, state.wf, state.sf);
      if (state.strikeStartDirection.dot(shaftUp) < -0.9999) q.deltaQ.setFromAxisAngle(pitchAxis, Math.PI);
      else q.deltaQ.setFromUnitVectors(state.strikeStartDirection, shaftUp);
      state.direction.copy(state.strikeStartDirection).applyQuaternion(q.stepQ.identity().slerp(q.deltaQ, t)).normalize(); // No rotation with tool pitch until the strike transition begins.
    } else if (dt > 0) {
      // The handle may freeze at Strike; connector momentum remains free through
      // Hold and Recovery. Pivot deceleration contributes torque instead of a cap.
      stepPendulum(state, q.pivotAcceleration, state.physicsLength, dt, 9.81, flailDamping(motion));
    }
    if (dt > 0 && state.attacking && !state.fishingFlailHeadSpin && state.progress < state.sf) {
      q.pitchCross.crossVectors(q.previousDirection, state.direction); // Real driven angular displacement includes simultaneous pitch, yaw, roll and body movement.
      const sine = q.pitchCross.length(); // Atan2 recovers signed 3D travel without choosing a dominant authored axis.
      if (state.hasPhysicsVelocity && sine > 1e-10) state.angularVelocity.copy(q.pitchCross).multiplyScalar(Math.atan2(sine, q.previousDirection.dot(state.direction)) / (sine * dt));
      else state.angularVelocity.set(0, 0, 0);
    }
    if (dt > 0 && !state.fishingFlailHeadSpin) state.hasPhysicsVelocity = true; // Head-only spin is a kinematic orbit, not an impulse into the pendulum integrator.
    }
    // Actor turn drives the same drag as translation. Measure body yaw independently of the held pose.
    const motionOwner=sharedPhysics||state; // Replicas use one heading sample and their own lever arms.
    if(!sharedPhysics&&dt>0){
      const player=motionOwner.movementPosition?global.PlayerBodyTransformComposer?.getPlayerMesh?.():null;
      const body=motionOwner.movementRoot||(player&&player.position===motionOwner.movementPosition?player:null);
      const world=body?.matrixWorld?.elements;
      const yaw=world?Math.atan2(world[8],world[10]):null;
      motionOwner.turnRate=world&&body===motionOwner.turnRoot?bodyYawRate(dt,motionOwner.turnYaw,yaw):0;
      motionOwner.turnRoot=body;
      motionOwner.turnYaw=yaw;
    }
    const bodyWorld=motionOwner.turnRoot?.matrixWorld?.elements; // World origin gives the radius to each actual haft.
    const turnX=bodyWorld?motionOwner.turnRate*(pivot.z-bodyWorld[14]):0;
    const turnZ=bodyWorld?-motionOwner.turnRate*(pivot.x-bodyWorld[12]):0;
    const bodyVX=(state.actorMotionValid?q.velocity.x:0)+turnX;
    const bodyVZ=(state.actorMotionValid?q.velocity.z:0)+turnZ;
    advanceIdleHeadMotion(state.idleHeadMotion,state.attacking,state.progress,state.sf,state.hf,pivot,bodyVX,bodyVZ,dt,state.idleHeadMotion.yaw??Math.atan2(normal.x,normal.z),headDeadzone());
    state.groundClearance=null;
    if (state.dualWieldHidden) return; // Hidden original owns the ONE pendulum and fitted length, but not live floor contact.
    // Ground contact can now change only the direction of the already
    // fitted rope. No frame, jump, or pendulum swing can make it longer.
    const idleQ=!state.attacking?idleHeadQuaternion(state,pivot,normal,q.headQ,dt):null;
    const liveDrop=contact&&idleQ?tiltedHeadDrop(contact,idleQ):null; // Conservative live support, never resizing fitted rope.
    const available=contact?pivot.y-(floor+.035+liveDrop*attachmentScale*headScale):null;
    if(contact&&Number.isFinite(available)&&!state.fishingFlailHeadSpin) {
      const solve=pose.ropeClearance(state.physicsLength,1,state.direction.y,available);
      if(solve?.trailing) {
        const restBody=!state.attacking?bodyWorld:null; // Travel and turning take priority over the shared resting direction.
        resolveTrailingDirection(state,q.velocity.x+turnX,q.velocity.z+turnZ,q.shaftUp.x,q.shaftUp.z,solve.directionY,dt,
          restBody?-restBody[8]:0,restBody?-restBody[10]:0);
        state.angularVelocity.multiplyScalar(.25);
      }
      state.groundClearance={length:state.physicsLength,fittedScale:fixedScale,trailing:!!solve?.trailing,headContact:contact.traced?'auto-alpha':contact.authored?'authored-edge':'bounds',floor,headMinY:pivot.y+state.physicsLength*state.direction.y-liveDrop*attachmentScale*headScale,reason:solve?'solved':'unreachable'};
    }
    const worldQ = planeQuaternion(q.headUp.copy(state.direction).negate(), normal, q.worldQ, q);
    worldQ.multiply(q.correction.setFromUnitVectors(chainSpan, q.axisUp)); // Align both opaque chain endpoints, not the image rectangle.
    const chainCenterWorld = q.chainCenter.copy(pivot).sub(q.tmp.copy(topLocal).multiplyScalar(attachmentScale).applyQuaternion(worldQ)); // Keep the already axis-scaled top contact pinned to the haft.
    const rootQInverse = q.rootInverseQ.copy(q.rootWorldQ).invert(); // root's baked matrixWorld was refreshed above and is unchanged since.
    const inverseRootWorld = q.rootInverseWorld.copy(root.matrixWorld).invert(); // One inverse serves both local anchors and both corrected part matrices.
    state.chain.position.copy(q.chainLocal.copy(chainCenterWorld).applyMatrix4(inverseRootWorld));
    state.chain.quaternion.copy(rootQInverse).multiply(worldQ); // Shared parent correction; a species' nonuniform body dimensions never distort world-facing suspension.
    const ropeWidthScale = state.chain.userData?.hobunjiRuinRopeSprite ? authoredChainScaleY : chainScaleX; // Pose length changes only Y, not the rope ribbon's visible width.
    const ropeDepthScale = state.chain.userData?.hobunjiRuinRopeSprite ? authoredChainScaleY : (state.chain.userData?.hobunjiGeneratedRope ? chainScaleX : 1);
    placeFlexiblePartWorld(state.chain, inverseRootWorld, chainCenterWorld, worldQ,
      q.partWorldScale.set(attachmentScale * ropeWidthScale, attachmentScale * chainScaleY, attachmentScale * ropeDepthScale), q.partWorldMatrix);
    const endWorld = q.endWorld.copy(chainCenterWorld).add(q.tmp.copy(bottomLocal).multiplyScalar(attachmentScale).applyQuaternion(worldQ)); // Use the stretched bottom endpoint without rescaling the head.
    const headSpec = flail.head;
    // Idle locomotion and attack orientation remain independent.
    const headQ = idleQ||planeQuaternion(q.headUp.copy(state.direction).negate(), normal, q.headQ, q);
    const layer = headSpec.layers.find(candidate => candidate.id === headSpec.anchorLayer); // Per-head authoring offset for the actual chain contact layer.
    const headAnchorLocal = headSpec.anchorSpace === 'composite'
      ? q.headAnchorLocal.set(state.headAnchor.x * unit, -state.headAnchor.y * unit, 0)
      : pixelPoint(state.headAnchorImage, state.headAnchor, unit, layer?.offsetPx, q.headAnchorLocal); // Shared center-frame contacts are allowed in the transparent gap between two sprite layers.
    const visual = headSpec.visualTransform; // Pair-only rigid head corrections, absent from the original grapple head.
    if (visual) {
      const sx = (Number(visual.scaleX) || 1) * (visual.flipX ? -1 : 1);
      const sy = (Number(visual.scaleY) || 1) * (visual.flipY ? -1 : 1);
      const angle = -(Number(visual.rotation) || 0) * Math.PI / 180;
      const xx = headAnchorLocal.x * sx, yy = headAnchorLocal.y * sy;
      headAnchorLocal.set(Math.cos(angle) * xx - Math.sin(angle) * yy,
        Math.sin(angle) * xx + Math.cos(angle) * yy, 0); // Head contact inherits the very same scale, flip and rotation as artwork.
    }
    const headCenterWorld = q.headCenter.copy(endWorld).sub(q.tmp.copy(headAnchorLocal).multiplyScalar(attachmentScale * headScale).applyQuaternion(headQ)); // Transformed contact stays at the rope's end.
    if (visual) {
      const dx = Number(visual.x) || 0, dy = Number(visual.y) || 0;
      headCenterWorld.add(q.tmp.set(dx * unit, -dy * unit, 0)
        .multiplyScalar(attachmentScale * headScale).applyQuaternion(headQ)); // Pair X/Y nudges move only head art, never the rope/chain.
    }
    state.headRoot.position.copy(q.headLocal.copy(headCenterWorld).applyMatrix4(inverseRootWorld));
    state.headRoot.quaternion.copy(rootQInverse).multiply(headQ);
    placeFlexiblePartWorld(state.headRoot, inverseRootWorld, headCenterWorld, headQ,
      q.partWorldScale.setScalar(attachmentScale * headScale), q.partWorldMatrix); // A single world-size head, independent of body-axis stretch and rope reach.
    if (root.visible !== false && !state.dualWieldHidden) {
      if (state.fireEmitters?.some(fx => fx.worldRise)) state.headRoot.updateMatrixWorld(true); // Refresh the newly posed head from the already baked root matrix.
      effects?.stepFire(state, effectsDt);
    } // Never emit a third set of particles from the hidden original head.
  }

  function tick(deltaS, freezePhysics = false) {
    const now = performance.now();
    const dt = Math.min(MAX_DT, Math.max(0, Number.isFinite(deltaS) ? deltaS : 1 / 60));
    for (const entry of records) {
      const state = liveState(entry);
      if (!state || state.dead) { records.delete(entry); continue; } // Prune collected roots lazily, without a separate timer.
      try {
        if (state.setupFailed && state.root.parent && now >= state.nextRetryAt) {
          const { root, itemKey, originalDef, originalOptions } = state;
          drop(root); // Dispose partial meshes before starting a fresh, idempotent reconstruction.
          decorate(root, itemKey, originalDef, originalOptions);
          continue;
        }
        if (state.root.parent && !state.dualWieldHidden) effects?.refreshMetal(state, now); // Hidden original uses neither material refresh nor head effects until its single-hand appearance returns.
        updateOne(state, freezePhysics ? 0 : dt, now, dt);
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
    const snapshot = []; // Mobile-accessible live-root diagnostics, including cached handles regardless of slot-map injection.
    for (const entry of records) {
      const s = liveState(entry);
      if (!s || s.dead) { records.delete(entry); continue; }
      snapshot.push({
      itemKey: s.itemKey, loaded: s.config.flail ? !!(s.chain && s.headRoot) : !!s.staticReady,
      fishingFlailHeadSpin: s.fishingFlailHeadSpin, fishingFlailSpinRevolutions: s.fishingFlailHeadSpin ? s.fishingFlailSpinRevolutions : null, // On-device verification of shaft-held, head-only spin mode.
      attached: !!s.root.parent, attacking: s.attacking,
      cachedPlayerOwned: isCachedPlayerToolRoot(s.root), // Displays cached equipment identity; weak-root lifetime remains independent of the map.
      detachedForMs: s.root.parent || !s.detachedAt ? 0 : Math.max(0, performance.now() - s.detachedAt), // Mobile proof that no time limit can destroy cached rope/head.
      progress: s.progress, direction: s.direction.toArray(),
      attackTiming: { windup: s.wf, strike: s.sf, hold: s.hf }, // Mobile-readable phase diagnostics.
      pitchTravelDeg: Number.isFinite(s.pitchTravelRad) ? s.pitchTravelRad * 180 / Math.PI : s.strikeTurnRad * 180 / Math.PI, // Authored pitch travel for comparison with physical motion.
      yawTravelDeg: s.yawTravelRad * 180 / Math.PI, // Authored sweep travel for comparison with measured world motion.
      physics: { model: 'taut-pendulum', length: s.physicsLength, angularVelocity: s.angularVelocity.toArray(), angularDamping: flailDamping(s.config.flail?.motion), gravity: 9.81 }, // Existing mobile snapshot exposes actual lever length and rad/s momentum.
      fire: (s.fireEmitters || []).map(fx => ({ layer: fx.sourceLayer.id, particles: fx.particles.length, sourcePixels: fx.sources.length, sourceFallback: fx.sourceFallback, clusters: fx.clusters?.length || 0, worldRise: fx.worldRise, modularShaft: s.config.flail ? null : s.itemKey.startsWith('modular:') ? s.itemKey.split(':')[1] : null, masteryRank: Number(fx.config.fixedMasteryRank ?? s.masteryLevel?.()) || 0, size: fx.config.size, visualScale: fx.visualScale, worldMoteSize: (Number(fx.config.size) || 0.035) * fx.visualScale, masteryFocus: fx.config.masteryFocus ?? 1, blend: fx.config.blendMode || 'additive', opacity: fx.config.opacity ?? 0.92, tipAnchors: fx.anchors?.map(anchor => [anchor.x, anchor.y]) || [], rate: fx.config.rate, life: fx.config.life, speed: fx.config.speed })), // Mobile tools inspect the actual shared emitter instead of a separate approximation.
      groundClearance: s.groundClearance || null, // Mobile diagnostics for shortened and trailing connectors.
      idleHead: s.config.flail?{yaw:s.idleHeadMotion.yaw,renderedYaw:s.idleHeadMotion.renderedYaw,leanX:s.idleHeadMotion.leanX,leanZ:s.idleHeadMotion.leanZ,source:s.idleHeadMotion.source}:null, // Phone-visible head motion diagnosis.
      lagSource: s.movementPosition ? 'character' : 'haft-fallback', // Mobile checks can distinguish locomotion from animated weapon movement.
      scale: s.config.flail ? {
        chainX: connectorAxisScale(s.config.flail.chain, 'scaleX'),
        chainY: connectorAxisScale(s.config.flail.chain, 'scaleY'),
        poseLength: s.flailLengthScale, // Physical length multiplier currently applied to the flail connector; 0.6 = 40% shorter.
        head: relativePartScale(s.config.flail.head),
        renderedHaftLong: s.renderedHaftLongScale ?? null, renderedHaftWidth: s.renderedHaftWidthScale ?? null, // Mobile-readable evidence of which baked haft axis drives the flexible parts.
      } : null, // Mobile diagnostics expose both independent connector axes.
      connector: s.config.flail?.chain?.type === 'rope' ? 'rope' : s.config.flail ? 'chain' : null,
      performance: s.config.flail ? { equilibriumSubstepsSkipped:s.equilibriumSkips||0, ropeFacingUpdates:s.chain?.children?.[0]?.userData?.ropeFacingUpdates||0, ropeFacingReuses:s.chain?.children?.[0]?.userData?.ropeFacingReuses||0 } : null, // Mobile diagnostics expose both handle-relative multipliers.
      ropeArt: s.chain?.userData?.hobunjiRuinRopeSprite ? 'assets/objectsprites/rope_long.png' : null, // Mobile confirmation of the rope source.
      ropeTint: s.chain?.userData?.hobunjiRuinRopeSprite ? { color: s.config.flail.chain.color, method: s.chain.children?.[0]?.userData?.ropeTintMethod || 'unavailable' } : null, // Confirms the real 3D texture was shade-filled, including editor previews, without accessing devtools.
      lifetime: weakRegistry ? 'root-weak' : 'explicit-drop', // Visible fallback for browsers without weak references.
      setupFailed: s.setupFailed, retryInMs: s.setupFailed ? Math.max(0, s.nextRetryAt - performance.now()) : 0, repairedParts: s.repairedParts, // Diagnose failed textures and automatic reparent recovery on mobile.
      partsAttached: !s.config.flail || (s.chain?.parent === s.root && s.headRoot?.parent === s.root), // Confirms both children follow the same cached handle after switching tools.
      dualFlail: s.config.flail ? { replica: !!s.root.userData?.hobunjiDualWieldDuplicate, originalHidden: !!s.dualWieldHidden, copiesReady: s.dualWieldReplicas?.length || 0, physics: s.dualPhysicsSource ? 'shared-world-sway' : 'simulated', physicsOwner: s.dualPhysicsSource?.itemKey || null } : null, // Mobile-visible confirmation: one simulated pendulum, both heads rendered.
    });
    }
    return snapshot;
  }

  // Pure selection step, exported for tests. While dual wield is active the held plane's base and its direct-child
  // overlay layers are hidden and replaced by two visible clones, so their enchantments follow the clones. Anything
  // dual wield does not clone (a flail head's layers live under their own head rig and stay visible) keeps emitting
  // from its source mesh; redirecting *every* target to clones silently dropped all flail enchantment motes.
  function dualWieldEnchantmentTargets(plane, sourceTargets) {
    const copies = [];
    const source = states.get(plane?.parent); // The assembly root also owns the original flexible head's metal masks.
    const clonedBySource = target => target.plane === plane || target.plane?.parent === plane
      || (!!source?.dualWieldHidden && source.headParts.includes(target.plane)); // Once both replica heads exist, never emit from the hidden original.
    for (const target of sourceTargets) if (!clonedBySource(target)) copies.push(target);
    plane.traverse?.(node => {
      const parentSource = node?.userData?.hobunjiDualWeaponSourceLayer; // The exact source layer cloned by the dual-wield renderer.
      for (const target of sourceTargets) {
        if (parentSource === target.plane
          || (target.plane === plane && node?.userData?.hobunjiDualWieldDuplicate)) {
          copies.push({ plane: node, mask: target.mask });
        }
      }
    });
    if (source?.dualWieldHidden) {
      for (const replica of source.dualWieldReplicas || []) {
        copies.push(...(states.get(replica)?.metalTargets || [])); // Keep the actual head's layer-specific mask and metal coverage for EACH hand.
      }
    }
    return copies;
  }

  // A freshly created but holstered flail may never have entered updateOne(),
  // so its live head and connector still sit at the origin. Compute a deterministic
  // idle pose from the same authored contact points, without moving gameplay nodes.
  function neutralPreviewMatrices(state) {
    const { THREE, plane, config: { flail }, chainImage, chainTop, chainBottom, headAnchorImage, headAnchor } = state;
    const baseImage = plane.material?.map?.image;
    if (!baseImage || !chainImage || !chainTop || !chainBottom || !headAnchor) return null;
    const unit = (plane.geometry?.parameters?.width || 0.5) / (baseImage.naturalWidth || baseImage.width || 1);
    const shaftPoint = pixelPoint(baseImage, anchor(baseImage, flail.haftAnchor, 'top'), unit, null, new THREE.Vector3()); // Unmodified haft artwork determines the attachment.
    const chainX = connectorAxisScale(flail.chain, 'scaleX');
    let chainY = connectorAxisScale(flail.chain, 'scaleY');
    const mountLength = Number(flail.chain.mountLengthPx);
    if (!state.chain.userData?.hobunjiRuinRopeSprite && Number.isFinite(mountLength) && mountLength > 0) {
      const spanX = (chainBottom.x - chainTop.x) * chainX;
      const spanY = Math.abs(chainBottom.y - chainTop.y);
      if (spanY > 1e-5) chainY = Math.sqrt(Math.max(1e-8, mountLength ** 2 - spanX ** 2)) / spanY;
    }
    const top = pixelPoint(chainImage, chainTop, unit, null, new THREE.Vector3());
    const bottom = pixelPoint(chainImage, chainBottom, unit, null, new THREE.Vector3());
    top.x *= chainX; top.y *= chainY;
    bottom.x *= chainX; bottom.y *= chainY; // Authored scaled opaque contacts, not guessed mesh edges.
    const span = bottom.clone().sub(top);
    if (span.lengthSq() < 1e-10) return null;
    const angle = -Math.PI / 2 - Math.atan2(span.y, span.x); // Render the idle connector downward from the haft.
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
    const chainPosition = shaftPoint.clone().sub(top.applyQuaternion(rotation));
    const end = chainPosition.clone().add(bottom.applyQuaternion(rotation));
    const rope = !!state.chain.userData?.hobunjiRuinRopeSprite;
    const chainScale = rope
      ? new THREE.Vector3(chainY, chainY, chainY)
      : new THREE.Vector3(chainX, chainY, state.chain.userData?.hobunjiGeneratedRope ? chainX : 1);
    const headSpec = flail.head;
    const headLayer = headSpec.layers.find(layer => layer.id === headSpec.anchorLayer);
    const contact = headSpec.anchorSpace === 'composite'
      ? new THREE.Vector3(headAnchor.x * unit, -headAnchor.y * unit, 0)
      : pixelPoint(headAnchorImage, headAnchor, unit, headLayer?.offsetPx, new THREE.Vector3());
    const visual = headSpec.visualTransform; // The same paired flip/rotation correction used by the live hanging head.
    if (visual) {
      const sx = (Number(visual.scaleX) || 1) * (visual.flipX ? -1 : 1);
      const sy = (Number(visual.scaleY) || 1) * (visual.flipY ? -1 : 1);
      const theta = -(Number(visual.rotation) || 0) * Math.PI / 180;
      const x = contact.x * sx, y = contact.y * sy;
      contact.set(Math.cos(theta) * x - Math.sin(theta) * y, Math.sin(theta) * x + Math.cos(theta) * y, 0);
    }
    const headScale = relativePartScale(headSpec);
    const headPosition = end.sub(contact.multiplyScalar(headScale));
    if (visual) headPosition.add(new THREE.Vector3((Number(visual.x) || 0) * unit * headScale,
      -(Number(visual.y) || 0) * unit * headScale, 0));
    return {
      chain: new THREE.Matrix4().compose(chainPosition, rotation, chainScale),
      headRoot: new THREE.Matrix4().compose(headPosition, new THREE.Quaternion(), new THREE.Vector3(headScale, headScale, headScale)),
    }; // Preview-owned values; never mutate state.chain, state.headRoot or their persistent pendulum.
  }

  // Read-only assembly bridge for the Loadout viewport: flexible parts are siblings
  // of the haft plane, not children of it. Never reparent the live equipment.
  function previewParts(plane) {
    const state = states.get(plane?.parent); // Only the exact cached weapon root can supply this head, rope and its authored metal masks.
    if (!state || state.plane !== plane || !state.config.flail) return null;
    if (!state.root.parent && state.chain && state.headRoot) {
      effects?.refreshMetal(state, performance.now()); // Holstered, never-held flail heads still receive their own saved plating/verdigris before previewing.
    }
    return {
      ready: !!(state.chain && state.headRoot && state.headParts.length === state.config.flail.head.layers.length),
      chain: state.chain, headRoot: state.headRoot,
      groundContactSprite: state.headParts[Math.max(0,state.config.flail.head.layers.findIndex(l=>l.id===state.config.flail.head.anchorLayer))]||null,
      neutralMatrices: neutralPreviewMatrices(state), // Valid even if this cached flail has never been drawn in the world.
      metalTargets: (state.metalTargets || []).slice(), // The live per-layer, post-occlusion head masks; the natural rope is not a metal emitter.
    };
  }

  function enchantmentTargets(visual) {
    const sourceTargets = states.get(visual)?.metalTargets || []; // Source masks exclude covered head/weapon metal; never include the chain.
    const plane = visual?.userData?.toolPlane;
    const dual = global.HobunjiDualWieldWeaponVisuals?.debugSnapshot?.();
    if (!plane || !(dual?.copiesVisible ?? dual?.active)) return sourceTargets; // Invisible idle-offhand clones are never drawn, so the real layers keep emitting.
    return dualWieldEnchantmentTargets(plane, sourceTargets);
  }

  const scheduledFrameTick = context => tick((context?.deltaMs || 0) / 1000); // The one canonical frame callback, reused when late-loaded pose systems subscribe.
  const frameTickOptions = { phase: 'pre-render', owner: 'HobunjiWeaponSpriteAssemblies',
    description: 'Projects flail ropes after dual-wield and procedural-hand poses are finalized' }; // Stable registration metadata for initial load and reordering.
  function scheduleTickAfterPose() {
    const scheduler = global.RuntimeFrameScheduler; // Reorders this existing callback only when another pose module registers later.
    if (scheduler?.unregister?.('weapon-sprite-assemblies') !== true) return false;
    scheduler.register('weapon-sprite-assemblies', scheduledFrameTick, frameTickOptions); // Map re-insertion moves the single tick after pose writers.
    return true;
  }

  global.HobunjiWeaponSpriteAssemblies = {
    definitions: DEF, assemblyKind, isGroundNonSolidChild, groundFitSpec, groundStatus:root=>states.get(root)?.groundClearance||null, decorate, setAction, tick, drop, syncDualWield, scheduleTickAfterPose, debugSnapshot, previewParts, enchantmentTargets, dualWieldEnchantmentTargets, bakedPoint,
    resolveTrailingDirection, opaqueAt, anchor, refreshWorldMatrix, definitionFor, ropeSpriteSizing, ropeOpaqueBounds, tintRopePixels, stepPendulum, bodyYawRate, flailDamping, flailStrikeStraightening, flailYawTravel, fishingFlailHeadDirection, clampIdleHeadYaw, easeIdleHeadYaw, stepIdleHeadMotion, advanceIdleHeadMotion, resetIdleHeadMotion, leanHeadBasis, tiltedHeadDrop, // Pure sizing and phase helpers have regression tests.
  };
  global.HobunjiCacheAudit?.register('weapon assemblies (weak owner registry)', () => { let count = 0; for (const entry of records) if (liveState(entry)) count++; return count; });
  if (global.RuntimeFrameScheduler?.register) {
    global.RuntimeFrameScheduler.register('weapon-sprite-assemblies', scheduledFrameTick, frameTickOptions);
  }
})(window);
