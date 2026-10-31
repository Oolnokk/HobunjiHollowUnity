// Shared Tool Hub 3D preview: actual gameplay assemblies and particle emitters.
// Pure alpha/layout helpers also serve sprite fitting and regression checks.
(function (global) {
  'use strict';
  if (global.HobunjiMultiSpritePreviewRenderer) return;

  const alphaCache = new WeakMap(); // Reuses the original PNG's opaque rectangle and contact-point scans across both previews.
  const ALPHA_MIN = 4; // Includes antialiasing when fitting the visible illustration.
  const CONTACT_ALPHA = 128; // Physical connection points use the same solid-pixel cutoff as the game.
  let lastLayout = null; // Latest measured artwork positions for in-editor diagnostics.

  function sourceData(image) {
    if (!image) return null;
    let result = alphaCache.get(image);
    if (result) return result;
    const w = image.naturalWidth || image.width || 0, h = image.naturalHeight || image.height || 0;
    if (!(w > 0 && h > 0)) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    let rgba = null;
    try {
      context.drawImage(image, 0, 0);
      rgba = context.getImageData(0, 0, w, h).data;
    } catch (error) {
      // This is an authoring preview. Do not hide a valid loaded sprite merely
      // because a custom cross-origin image cannot expose alpha pixels.
      rgba = null;
    }
    let left = w, top = h, right = 0, bottom = 0;
    let topSum = 0, topCount = 0, bottomSum = 0, bottomCount = 0;
    let contactTop = -1, contactBottom = -1;
    if (rgba) for (let y = 0; y < h; y++) {
      let rowSum = 0, rowCount = 0;
      for (let x = 0; x < w; x++) {
        const a = rgba[(y * w + x) * 4 + 3];
        if (a >= ALPHA_MIN) {
          left = Math.min(left, x); top = Math.min(top, y);
          right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
        }
        if (a >= CONTACT_ALPHA) { rowSum += x; rowCount++; }
      }
      if (!rowCount) continue;
      if (contactTop < 0) { contactTop = y; topSum = rowSum; topCount = rowCount; }
      contactBottom = y; bottomSum = rowSum; bottomCount = rowCount;
    }
    if (!(left < right && top < bottom)) { left = 0; top = 0; right = w; bottom = h; }
    result = {
      width: w, height: h,
      opaque: { left, top, right, bottom },
      top: { x: contactTop < 0 ? (w - 1) / 2 : topSum / topCount, y: contactTop < 0 ? 0 : contactTop },
      bottom: { x: contactBottom < 0 ? (w - 1) / 2 : bottomSum / bottomCount, y: contactBottom < 0 ? h - 1 : contactBottom },
    };
    alphaCache.set(image, result);
    return result;
  }

  function anchor(image, spec, edge) {
    const meta = sourceData(image);
    if (!meta) return { x: 0, y: 0 };
    if (Number.isFinite(spec?.x) && Number.isFinite(spec?.y))
      return { x: Math.max(0, Math.min(meta.width - 1, spec.x)), y: Math.max(0, Math.min(meta.height - 1, spec.y)) };
    return meta[spec?.opaque === 'bottom' ? 'bottom' : spec?.opaque === 'top' ? 'top' : edge] || meta.top;
  }

  function rotate(x, y, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  function offset(part) {
    return { x: Number(part?.offsetPx?.x) || 0, y: Number(part?.offsetPx?.y) || 0 };
  }

  function pointOnSprite(image, x, y, part) {
    const size = sourceData(image);
    const o = offset(part);
    return { x: x - size.width / 2 + o.x, y: y - size.height / 2 + o.y };
  }

  function partScale(part) {
    const n = Number(part?.scale ?? 1); // Uses the same validated handle-relative multiplier as the gameplay assembly renderer.
    return Number.isFinite(n) ? Math.max(0.05, Math.min(8, n)) : 1;
  }

  function connectorAxisScale(part, axis) {
    const n = Number(part?.[axis] ?? part?.scale ?? 1); // Match gameplay's axis scaling and backward compatibility for uniform drafts.
    return Number.isFinite(n) ? Math.max(0.05, Math.min(8, n)) : 1;
  }

  function modelFor(def, lookup, progress, clock = 0) {
    const basePath = def.sprite || (def.flail?.chain ? 'assets/toolsprites/hachutu_torch-flail_handle.png' : '');
    const shaft = lookup(basePath);
    const flail = def.flail;
    const swing = progress > 0.001 && progress < .98;
    const shaftRotation = swing ? Math.sin(progress * Math.PI * 2) * .32 : 0;
    const model = {
      definition: def, progress, // The 3D view uses the original recipe and real timeline rather than the layout helper's diagram pose.
      shaft, basePath, shaftRotation, baseLayers: def.layers || [],
      flail, parts: flail?.head?.layers || [], pivot: null,
      chain: null, chainTop: null, chainBottom: null, chainRotation: 0,
      rope: flail?.chain?.type === 'rope' ? {
        length: Math.max(2, Math.min(2048, Number(flail.chain.lengthPx) || 160)),
        radius: Math.max(.25, Math.min(30, Number(flail.chain.radiusPx) || 2.5)),
        color: flail.chain.color || '#6B4728',
      } : null, // Generated totem-style rope has no image asset and uses original-handle-pixel units.
      headOrigin: null, headPosition: null, headRotation: 0,
      chainScaleX: connectorAxisScale(flail?.chain, 'scaleX'), // Horizontal chain width and rope thickness.
      chainScaleY: connectorAxisScale(flail?.chain, 'scaleY'), // Vertical connector reach.
      headScale: partScale(flail?.head), // Independent head scale remains relative to the handle.
    }; // Used by both independently fitted canvases; source pixels remain authoritative.
    if (!shaft || !flail) return model;
    const chain = model.rope ? {width:1,height:model.rope.length+1} : lookup(flail.chain?.sprite);
    if (!chain) return model;
    model.chain = chain;
    const baseAnchor = anchor(shaft, flail.haftAnchor, 'top');
    const p = pointOnSprite(shaft, baseAnchor.x + .5, baseAnchor.y + .5);
    model.pivot = rotate(p.x, p.y, shaftRotation);
    model.chainTop = model.rope ? {x:0,y:0} : anchor(chain, flail.chain?.top, 'top');
    model.chainBottom = model.rope ? {x:0,y:model.rope.length} : anchor(chain, flail.chain?.bottom, 'bottom');
    const cx = model.chainBottom.x - model.chainTop.x;
    const cy = model.chainBottom.y - model.chainTop.y;
    const len = Math.hypot(cx * model.chainScaleX, cy * model.chainScaleY); // Endpoint span after independent scaling.
    const tilt = swing
      ? Math.sin(progress * Math.PI * 2) * (0.8 + (Number(flail.motion?.lag) || .065))
      : Math.sin(clock * .0013) * .04;
    const angle = Math.PI / 2 + tilt;
    model.chainRotation = angle - Math.atan2(cy * model.chainScaleY, cx * model.chainScaleX); // Orient the stretched chain's endpoint vector.
    model.headPosition = {
      x: model.pivot.x + Math.cos(angle) * len,
      y: model.pivot.y + Math.sin(angle) * len, // Width-only changes do not lengthen a vertical rope.
    }; // Physical chain span uses the actual opaque endpoint distance, not its entire canvas height.
    const head = flail.head;
    const target = model.parts.find(part => part.id === head?.anchorLayer) || model.parts[0];
    const targetImage = lookup(target?.sprite);
    if (!targetImage) return model;
    const headContact = head?.anchorSpace === 'composite'
      ? {x:Number(head.anchor?.x)||0,y:Number(head.anchor?.y)||0}
      : anchor(targetImage, head?.anchor, 'bottom');
    const origin = head?.anchorSpace === 'composite' ? headContact
      : pointOnSprite(targetImage, headContact.x + .5, headContact.y + .5, target); // Composite hinge can sit between back and front art.
    model.headRotation = swing ? tilt : 0;
    const rotatedContact = rotate(origin.x, origin.y, model.headRotation);
    model.headOrigin = {
      x: model.headPosition.x - rotatedContact.x * model.headScale,
      y: model.headPosition.y - rotatedContact.y * model.headScale, // Independent head sizing preserves contact at chain end.
    }; // Every head layer is positioned relative to this same corrected contact anchor.
    return model;
  }

  function emptyBounds() { return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }; }
  function addPoint(b, x, y) {
    b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y);
  }
  function addOpaque(b, image, origin, angle = 0, part = null, relativeTo = null, scale = 1) {
    const data = sourceData(image);
    if (!data) return;
    const o = offset(part), a = data.opaque;
    const corners = [
      [a.left, a.top], [a.right, a.top], [a.right, a.bottom], [a.left, a.bottom],
    ];
    for (const [x, y] of corners) {
      const sx = typeof scale === 'number' ? scale : (scale?.x ?? 1); // Horizontal fit multiplier for stretched chain sprites.
      const sy = typeof scale === 'number' ? scale : (scale?.y ?? 1); // Vertical fit multiplier; other pieces use the original scalar.
      const p = rotate((x - data.width / 2 + o.x - (relativeTo?.x || 0)) * sx,
        (y - data.height / 2 + o.y - (relativeTo?.y || 0)) * sy, angle);
      addPoint(b, origin.x + p.x, origin.y + p.y); // Fit the actual rotated, stretched art to prevent clipping.
    }
  }

  function boundsFor(model, lookup, kind, soloIndex = -1, stackTarget = 'head') {
    const bounds = emptyBounds();
    if (kind === 'head') {
      if (model.flail && stackTarget === 'head') {
        model.parts.forEach((part, i) => {
          if (soloIndex < 0 || i === soloIndex) addOpaque(bounds, lookup(part.sprite), { x: 0, y: 0 }, 0, part);
        });
      } else {
        if (soloIndex < 0) addOpaque(bounds, model.shaft, { x: 0, y: 0 });
        model.baseLayers.forEach((part, i) => {
          if (soloIndex < 0 || i === soloIndex) addOpaque(bounds, lookup(part.sprite), { x: 0, y: 0 }, 0, part);
        });
      }
    } else {
      addOpaque(bounds, model.shaft, { x: 0, y: 0 }, model.shaftRotation);
      model.baseLayers.forEach(part => addOpaque(bounds, lookup(part.sprite), { x: 0, y: 0 }, model.shaftRotation, part));
      if (model.chain && model.pivot) {
        if (model.rope) {
          const diameter = model.rope.radius * 2 * model.chainScaleX; // Width affects silhouette but not length.
          for (const point of [model.pivot, model.headPosition]) if (point) {
            addPoint(bounds,point.x-diameter,point.y-diameter);
            addPoint(bounds,point.x+diameter,point.y+diameter);
          }
        } else {
          const top = model.chainTop, d = sourceData(model.chain);
          addOpaque(bounds, model.chain, model.pivot, model.chainRotation, null, {
            x: top.x + .5 - d.width / 2, y: top.y + .5 - d.height / 2,
          }, { x: model.chainScaleX, y: model.chainScaleY });
        }
        addPoint(bounds, model.pivot.x, model.pivot.y);
      }
      if (model.headOrigin) model.parts.forEach(part => addOpaque(bounds,
        lookup(part.sprite), model.headOrigin, model.headRotation, part, null, model.headScale));
      if (model.headPosition) addPoint(bounds, model.headPosition.x, model.headPosition.y);
    }
    if (!Number.isFinite(bounds.minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1, empty: true };
    return bounds;
  }

  function fit(bounds, width, height) {
    const rangeX = Math.max(1, bounds.maxX - bounds.minX);
    const rangeY = Math.max(1, bounds.maxY - bounds.minY);
    const zoom = Math.min(12, Math.max(.001, Math.min(width * .82 / rangeX, height * .80 / rangeY)));
    return {
      zoom, x: width / 2 - (bounds.minX + bounds.maxX) / 2 * zoom,
      y: height / 2 - (bounds.minY + bounds.maxY) / 2 * zoom,
      // A fit of the complete assembly always includes shaft + chain + head.
      visibleWidth: rangeX * zoom, visibleHeight: rangeY * zoom,
    };
  }

  let live = null; // One real gameplay assembly is shared by the detail and combined WebGL cameras.
  let generation = 0; // Explicit editing events invalidate assemblies without serializing recipes each frame.
  const views = new Map(); // Two persistent WebGL renderers, cameras and orbit controls; no additional RAF.
  const DURATION = 1 / .65; // Matches the existing authoring timeline speed in app.js.

  function releaseAssembly() {
    if (!live?.root) return;
    global.HobunjiWeaponSpriteAssemblies.drop(live.root); // Shared cleanup owns all head/rope materials and particle pools.
    live.root.parent?.remove(live.root);
    live.plane.geometry.dispose(); live.plane.material.map?.dispose(); live.plane.material.dispose();
    live.root = null;
  }

  function sceneState() {
    if (live) return live;
    const THREE = global.THREE; // Same Three.js release and sprite surface helpers as the Attack Animation Editor.
    if (!THREE?.WebGLRenderer || !THREE.OrbitControls || !global.HobunjiWeaponSpriteAssemblies || !global.HobunjiSpritePngSurface) throw Error('3D preview dependencies did not load. Reload with a network connection.');
    const scene = new THREE.Scene(); // The two canvases render the same scene, including the very same live particles.
    scene.background = new THREE.Color('#0f1b29');
    scene.add(new THREE.HemisphereLight(0xffffff, 0x687580, 1)); // Generated rope uses the game's lit material; PNGs remain unlit.
    live = {
      THREE, scene, root: null, plane: null, head: null, nodes: [], headNodes: [],
      generation: -1, revision: -1, weaponKey: '', baseSource: null, progress: 0, ready: false,
      corner: new THREE.Vector3(), size: new THREE.Vector3(), center: new THREE.Vector3(), offset: new THREE.Vector3(),
      ropeBounds: new THREE.Box3(), bounds: new THREE.Box3(), actor: new THREE.Vector3(), metalOptions: null,
    }; // All reusable scene and framing scratch objects are allocated once.
    return live;
  }

  function applyPreviewPose(t) {
    const l = live, sample = global.SharedAttackPose?.fourPhaseLerp; // Reuse the game's exact four-stage pose sampler.
    if (!sample) throw Error('Shared attack-pose sampler did not load');
    l.plane.rotation.set(sample(t, .16, .42, .72, 0, -1.1, .85), sample(t, .16, .42, .72, 0, -.25, .35), 0, 'YXZ');
    global.HobunjiWeaponSpriteAssemblies.setAction(l.root, {
      attacking: t > .001 && t < .999, progress: t,
      movementPosition: l.actor, windupFrac: .16, strikeFrac: .42, holdFrac: .72,
    }); // Representative authoring swing; actual authored attacks remain available in the Attack Animation Editor.
  }

  function beginFrame(model, lookup, paint, options = {}) {
    const l = sceneState(), api = global.HobunjiWeaponSpriteAssemblies; // Actual gameplay assembly authority drives motion and emitters.
    const source = lookup(model.basePath); // Identity changes only once when a previously pending haft PNG finishes loading.
    l.metalOptions = options.metalOptions;
    l.masteryRank = options.masteryRank ?? 0; // Preview-only rank remains live without rebuilding the emitter or camera.
    if (!l.root || l.generation !== generation || l.revision !== options.revision || l.weaponKey !== options.weaponKey || l.baseSource !== source) {
      releaseAssembly();
      const base = source || document.createElement('canvas'); // A missing haft must not prevent inspection of already-loaded head layers.
      if (!source) { base.width = 512; base.height = 512; }
      const tex = global.HobunjiSpritePngSurface.makeCanvasTexture(l.THREE, base, 'weapon-preview-haft'); // Canonical PNG color/filter pipeline.
      l.plane = new l.THREE.Mesh(new l.THREE.PlaneGeometry(.5, .5 * (base.naturalHeight || base.height) / (base.naturalWidth || base.width)), global.HobunjiSpritePngSurface.makeMaterial(l.THREE, tex, 'weapon-preview-haft', { side: l.THREE.DoubleSide, depthWrite: false }));
      l.plane.renderOrder = 1.5; l.plane.visible = !!source;
      l.root = new l.THREE.Group(); l.root.userData.toolPlane = l.plane;
      l.root.add(l.plane); l.scene.add(l.root);
      api.decorate(l.root, options.weaponKey, { sprite: model.basePath, weaponAssembly: model.definition }, { THREE: l.THREE, metalOptions: () => l.metalOptions, masteryLevel: () => l.masteryRank });
      l.baseSource = source; l.weaponKey = options.weaponKey; l.generation = generation; l.revision = options.revision;
      l.head = null; l.ready = false; l.nodes.length = 0; l.headNodes.length = 0; l.progress = -1;
      for (const view of views.values()) view.needsFit = true;
    }
    const paintedBase = paint({ sprite: model.basePath, material: model.definition.base?.material || 'metal',
      sourceHex: model.definition.base?.sourceHex, targetHex: model.definition.base?.targetHex }); // Base PNGs can use marker tint with no metal/verdigris layer at all.
    if (paintedBase && l.plane.material.map.image !== paintedBase) {
      l.plane.material.map.image = paintedBase; l.plane.material.map.needsUpdate = true;
    }
    if (!l.ready) {
      l.head = l.root.children.find(child => child.name === options.weaponKey + '_flail_head') || null;
      let staticLayersReady = 0; // Pending ordinary-weapon overlays must finish before caching scene meshes.
      for (const child of l.plane.children) if (child.isMesh && child.userData?.hobunjiWeaponAssemblyPart) staticLayersReady++;
      if (l.head || !model.flail && staticLayersReady >= model.baseLayers.length) {
        l.root.traverse(child => { if (child.isMesh) l.nodes.push(child); }); // One shallow assembly scan after async layer construction, never a per-frame scene traversal.
        if (l.head) l.head.traverse(child => { if (child.isMesh) l.headNodes.push(child); });
        l.ready = true;
        applyPreviewPose(0); api.tick(0);
        for (let step = 0; step < 80; step++) api.tick(1 / 120, true); // Prime the real fire so a paused edit immediately shows its full steady-state strength.
      }
    }
    if (!options.playing && l.progress !== model.progress || l.progress < 0 && model.progress > 0) {
      applyPreviewPose(0); api.tick(0);
      const steps = Math.ceil(model.progress * DURATION * 120); // Reconstruct physical momentum on direct timeline seeks.
      for (let step = 1; step <= steps; step++) {
        applyPreviewPose(model.progress * step / steps);
        api.tick(model.progress * DURATION / steps);
      }
    }
    applyPreviewPose(model.progress);
    api.tick(options.dt || 0, options.playing === false); // Motion may pause while the actual game fire continues to evolve.
    l.progress = model.progress;
  }

  function viewFor(canvas) {
    let view = views.get(canvas); // Preserve camera angle and user zoom through live recipe edits.
    if (view) return view;
    const THREE = live.THREE, renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); // Real perspective rendering and additive sprite blending.
    renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
    const camera = new THREE.PerspectiveCamera(40, 1, .01, 1000), controls = new THREE.OrbitControls(camera, canvas); // Touch orbit/pinch and mouse orbit/wheel use the same controls as the attack editor.
    controls.enableDamping = true; controls.enablePan = false; controls.minDistance = .01; controls.maxDistance = 100;
    view = { renderer, camera, controls, needsFit: true, width: 0, height: 0, hidden: [], visibility: [], center: new THREE.Vector3() }; // Per-canvas scratch prevents temporary visibility changes from leaking to the combined view.
    views.set(canvas, view);
    return view;
  }

  function measureNodes(nodes) {
    const l = live, box = l.bounds.makeEmpty(); // Compute world bounds from cached sprite alpha rectangles and current physical transforms.
    l.scene.updateMatrixWorld(true);
    for (const node of nodes) {
      if (!node.visible) continue;
      const image = node.material?.map?.image, params = node.geometry?.parameters; // Alpha bounds avoid fitting acres of transparent PNG margin.
      if (node.userData?.hobunjiGeneratedRope) {
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        box.union(l.ropeBounds.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld)); // Rope mesh bounds are tiny; image-based sprite bounds do not apply.
        continue;
      }
      if (!image || !params?.width || !params?.height) continue;
      const meta = sourceData(image); // Cached on the actual source/canvas identity.
      if (!meta) continue;
      for (let i = 0; i < 4; i++) {
        const x = i & 1 ? meta.opaque.right : meta.opaque.left, y = i & 2 ? meta.opaque.bottom : meta.opaque.top; // Four original-image corners in world space.
        l.corner.set((x / meta.width - .5) * params.width, (.5 - y / meta.height) * params.height, 0).applyMatrix4(node.matrixWorld);
        box.expandByPoint(l.corner);
      }
    }
    if (box.isEmpty()) { box.min.set(-.25, -.25, -.25); box.max.set(.25, .25, .25); }
    return box;
  }

  function fireReach(model) {
    let reach = 0; // Frame all of the actual world-sized motes, including inherited head scaling and lifetime travel.
    for (const part of model.parts) {
      if (part.vfx?.type !== 'fire') continue;
      const scale = model.parts.includes(part) ? model.headScale : 1; // The gameplay emitter lives under the independently scaled head root.
      const size = Math.max(.004, Number(part.vfx.size) || .035), life = Math.max(.1, Number(part.vfx.life) || .65), speed = Number.isFinite(part.vfx.speed) ? Math.max(0, part.vfx.speed) : .12; // Matches the shared emitter's local-world units.
      reach = Math.max(reach, scale * (size * 2 + speed * life * 1.5));
    }
    for (const part of [model.definition.base, ...model.baseLayers].filter(Boolean)) { // The rigid base PNG can itself emit fire without overlays.
      if (part.vfx?.type === 'fire') reach = Math.max(reach, Math.max(.004, Number(part.vfx.size) || .035) * 2 + (Number(part.vfx.speed) || .12) * Math.max(.1, Number(part.vfx.life) || .65) * 1.5);
    }
    return reach;
  }

  function drawCanvas(canvas, kind, model, lookup, paint, options = {}) {
    if (!canvas || !live?.root) return null;
    const l = live, view = viewFor(canvas), headOnly = kind === 'head' && l.head && options.stackTarget === 'head'; // Both views render identical geometry and particle state.
    view.hidden.length = 0; view.visibility.length = 0;
    const hide = node => { view.hidden.push(node); view.visibility.push(node.visible); node.visible = false; }; // Temporary visibility is restored even when rendering fails.
    try {
      if (headOnly) for (const child of l.root.children) if (child !== l.head) hide(child);
      if (kind === 'head' && options.solo) {
        const owner = headOnly ? l.head : l.plane, parts = headOnly ? model.parts : model.baseLayers; // Solo supports head layers and ordinary weapon overlays.
        const chosen = parts[options.selected]; // Emitter and selected source layer remain visible together.
        let index = 0; // Sprite children retain authored ordering, while fire groups have their own tagged names.
        for (const child of owner.children) {
          if (child.userData?.weaponInterleavedVfx) { if (child.name !== 'weapon_interleaved_fire_' + chosen?.id) hide(child); }
          else if (child.isMesh && child.userData?.hobunjiWeaponAssemblyPart && index++ !== options.selected) hide(child);
        }
      }
      const width = Math.max(1, canvas.clientWidth || 640), height = Math.max(1, canvas.clientHeight || 320); // Logical CSS size preserves mobile DPR.
      if (width !== view.width || height !== view.height) {
        view.renderer.setSize(width, height, false); view.camera.aspect = width / height; view.camera.updateProjectionMatrix();
        view.width = width; view.height = height; view.needsFit = true;
      }
      const box = measureNodes(headOnly ? l.headNodes : l.nodes), reach = fireReach(model); // Visual framing includes steady-state fire, not just metal artwork.
      box.getCenter(l.center); box.getSize(l.size);
      if (view.needsFit && l.ready) {
        const radius = Math.max(.05, l.size.length() * .5 + reach); // Enclose the entire 3D stack and its full emitter reach.
        const fov = Math.min(view.camera.fov * Math.PI / 180, 2 * Math.atan(Math.tan(view.camera.fov * Math.PI / 360) * view.camera.aspect)); // Portrait canvases fit the narrow horizontal field too.
        view.camera.position.copy(l.center).add(l.offset.set(0, radius * .15, radius / Math.sin(fov / 2) * 1.12));
        view.controls.target.copy(l.center); view.center.copy(l.center); view.needsFit = false;
      } else {
        l.offset.copy(l.center).sub(view.center); view.camera.position.add(l.offset); view.controls.target.add(l.offset); view.center.copy(l.center); // Follow a moving head without replacing the author's orbit angle or zoom.
      }
      view.controls.update();
      view.renderer.render(l.scene, view.camera);
      lastLayout ||= {};
      lastLayout[kind] = { mode: 'gameplay-3d', ready: l.ready, partsReady: l.headNodes.length, partsExpected: model.parts.length, chainReady: !!l.head, haftReady: !!l.baseSource, fireReach: reach, worldHandleWidth: .5, cameraDistance: view.camera.position.distanceTo(view.controls.target) }; // Copy diagnostics includes actual world scale and framing.
      return lastLayout[kind];
    } finally {
      for (let i = 0; i < view.hidden.length; i++) view.hidden[i].visible = view.visibility[i]; // Solo/head views never strip the combined view.
    }
  }

  function resetEffects() { generation++; } // Next frame rebuilds through the existing authority and disposes old particle pools.
  function resetView() { for (const view of views.values()) view.needsFit = true; } // Explicit reset restores fitting after manual zoom/orbit.
  global.HobunjiMultiSpritePreviewRenderer = Object.freeze({
    modelFor, boundsFor, fit, beginFrame, drawCanvas, resetEffects, resetView, fireReach,
    debugSnapshot: () => ({ ...lastLayout, physics: global.HobunjiWeaponSpriteAssemblies?.debugSnapshot(), renderer: 'shared-gameplay-3d' }),
  });
})(window);
