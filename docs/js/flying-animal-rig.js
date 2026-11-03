// Shared Three.js assembly for two-bone flying animal rigs.
(() => {
  'use strict';

  const DEG = Math.PI / 180; // Authoring angles are in degrees.
  const DEFAULT = Object.freeze({
    version: 1,
    flying: 'creaturesprites/tzatzul_flying.png',
    perched: 'creaturesprites/tzatzul_perched.png',
    wings: 'creaturesprites/tzatzul_wings.png',
    leftHinge: 0.435, rightHinge: 0.467,
    wingScale: 1.41, wingHeight: 0.15, wingOffset: -0.18, wingCenter: 0.451,
    flapUp: 43, flapDown: 28, flapHz: 2.2, glideAngle: 7,
    yawDeadzone: 27.5, pitchDeadzone: 22,
  });
  const limits = Object.freeze({ // Bounds shared by JSON import and the author controls.
    leftHinge: [0.01, 0.98], rightHinge: [0.02, 0.99],
    wingScale: [0.1, 4], wingHeight: [-1, 1], wingOffset: [-2, 2], wingCenter: [0, 1],
    flapUp: [0, 85], flapDown: [0, 85], flapHz: [0.1, 10], glideAngle: [-45, 45],
    yawDeadzone: [0, 45], pitchDeadzone: [0, 45],
  });

  const PERCH_POSE_PADDING = .75; // Extra pose workspace above and below the source image.

  function normalizePerchSpline(input) {
    const spline = window.AnimalShoulderSpline;
    const guide = spline.linearPointsForGuide({ a: { x: .12, y: .42 }, b: { x: .9, y: .4 } });
    function points(value, fallback, padding = 0) {
      if (value === undefined) return fallback.map(point => ({ ...point }));
      if (!Array.isArray(value) || value.length !== spline.POINT_COUNT ||
          value.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) {
        throw new Error('Perched body splines need seven finite x/y points per line.');
      }
      return value.map(({ x, y }) => ({ x: Math.max(0, Math.min(1, x)), y: Math.max(-padding, Math.min(1 + padding, y)) }));
    }
    const beforePoints = points(input?.beforePoints, guide);
    return { beforePoints, afterPoints: points(input?.afterPoints, beforePoints, PERCH_POSE_PADDING) };
  }

  function normalize(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a flying animal rig object.');
    if (input.version !== undefined && input.version !== DEFAULT.version) throw new Error('Unsupported flying animal rig version.');
    const rig = { ...DEFAULT }; // Independent settings for this assembly.
    for (const key of ['flying', 'perched', 'wings']) {
      if (input[key] === undefined) continue;
      if (typeof input[key] !== 'string' || !/^[\w .()/\-]+\.png$/i.test(input[key]) ||
          input[key].startsWith('/') || input[key].split('/').includes('..')) {
        throw new Error(`${key} must be a PNG path relative to the assets folder.`);
      }
      rig[key] = input[key];
    }
    for (const [key, [min, max]] of Object.entries(limits)) {
      if (input[key] === undefined) continue;
      if (!Number.isFinite(input[key])) throw new Error(`${key} must be a number.`);
      rig[key] = Math.min(max, Math.max(min, input[key]));
    }
    rig.leftHinge = Math.min(rig.leftHinge, rig.rightHinge - 0.01);
    if (input.perchSpline !== undefined) rig.perchSpline = normalizePerchSpline(input.perchSpline);
    return rig;
  }

  function flapAngle(rig, pose, seconds) {
    if (pose !== 'flap') return rig.glideAngle * DEG;
    const wave = Math.sin(seconds * rig.flapHz * 2 * Math.PI); // Smooth stroke between the authored extremes.
    return ((rig.flapUp - rig.flapDown) / 2 + wave * (rig.flapUp + rig.flapDown) / 2) * DEG;
  }

  function create(rigInput, images) {
    const rig = normalize(rigInput); // Settings captured by this renderer.
    const THREE = window.THREE; // Uses the host's Three.js build.
    const png = window.HobunjiSpritePngSurface; // Canonical game PNG material and texture setup.
    const root = new THREE.Group(); // World placement and heading belong to the caller.
    const yaw = new THREE.Group(); // Camera correction in the caller's heading frame.
    const pitch = new THREE.Group(); // Local X correction after yaw.
    root.add(yaw);
    yaw.add(pitch);

    function material(key, overrides) {
      const name = `flying-animal-${key}`; // Name visible in renderer diagnostics.
      return png.makeMaterial(THREE, png.makeCanvasTexture(THREE, images[key], name), name, { side: THREE.DoubleSide, ...overrides });
    }

    function body(key) {
      const image = images[key]; // Keep the original sprite aspect ratio.
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(image.width / image.height, 1, key === 'perched' ? 32 : 1, key === 'perched' ? 20 : 1), material(key));
      pitch.add(mesh);
      return mesh;
    }

    const flying = body('flying'); // Side profile while the wing rig is visible.
    const perched = body('perched'); // Folded-wing side profile.
    function setPerchSpline(authored) {
      const geometry = perched.geometry; // Deform the existing mesh without reloading any PNGs.
      const { position, uv } = geometry.attributes;
      const width = geometry.parameters.width;
      const spline = window.AnimalShoulderSpline;
      const moved = authored?.beforePoints.some((point, i) =>
        point.x !== authored.afterPoints[i].x || point.y !== authored.afterPoints[i].y);
      const rest = moved ? spline.normalizeRest({ ...authored, separatorAspect: width }) : null;
      for (let i = 0; i < position.count; i++) {
        const source = { x: uv.getX(i), y: 1 - uv.getY(i) };
        const target = rest ? spline.deformNormalizedPoint(source, rest) : source;
        position.setXYZ(i, (target.x - .5) * width, .5 - target.y, 0);
      }
      position.needsUpdate = true;
      geometry.computeBoundingSphere();
    }
    if (rig.perchSpline) setPerchSpline(rig.perchSpline);

    const image = images.wings; // Top-down art, head toward the image's top edge.
    const span = image.width / image.height * rig.wingScale; // Width along local Z.
    const cuts = [0, rig.leftHinge, rig.rightHinge, 1]; // Insert a vertex column at each hinge.
    const geometry = new THREE.PlaneGeometry(1, 1, 3, 1);
    const positions = geometry.attributes.position; // Map UV columns to the authored cuts.
    const uv = geometry.attributes.uv;
    const indices = [], weights = []; // Skin each outer panel to one bone; the middle connects the two stationary hinge axes.
    for (let i = 0; i < positions.count; i++) {
      const column = i % cuts.length;
      const u = cuts[column], v = uv.getY(i);
      positions.setXYZ(i, (0.5 - v) * rig.wingScale + rig.wingOffset, rig.wingHeight, (u - rig.wingCenter) * span);
      uv.setX(i, u);
      indices.push(column < 2 ? 0 : 1, 0, 0, 0);
      weights.push(1, 0, 0, 0);
    }
    geometry.computeVertexNormals();
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    // Three.js r128 needs the material flag to apply bone transforms in the shader.
    const wings = new THREE.SkinnedMesh(geometry, material('wings', { skinning: true }));
    const bones = cuts.slice(1, 3).map((hinge, index) => {
      const bone = new THREE.Bone();
      bone.name = index === 0 ? 'Left wing' : 'Right wing';
      bone.position.set(0, rig.wingHeight, (hinge - rig.wingCenter) * span);
      wings.add(bone);
      return bone;
    });
    // Bind in the assembly's neutral frame. Animated tips can exceed the bind-pose bounds.
    pitch.add(wings);
    wings.bind(new THREE.Skeleton(bones));
    wings.frustumCulled = false;

    const view = new THREE.Vector3(); // Reused for camera position in each correction frame.
    const yawState = { localPerpsOnly: true }, pitchState = { localPerpsOnly: true }; // Independent clamp hysteresis.
    const perps = [0, 0]; // Scratch input to the shared deadzone solver.
    function correct(state, bearing, radius) {
      if (radius === 0) return 0;
      perps[0] = bearing + Math.PI / 2;
      perps[1] = bearing - Math.PI / 2;
      return window.PerpRotation.perpClamp(state, 0, perps, radius * DEG).effectiveTarget;
    }

    function update(camera, pose, seconds) {
      const grounded = pose === 'perched'; // Perched preview retains only the usual yaw deadzone.
      flying.visible = wings.visible = !grounded;
      perched.visible = grounded;
      camera.getWorldPosition(view);
      root.worldToLocal(view);
      if (Math.hypot(view.x, view.z) > 1e-6) yaw.rotation.y = correct(yawState, Math.atan2(view.x, view.z), rig.yawDeadzone);
      const depth = view.x * Math.sin(yaw.rotation.y) + view.z * Math.cos(yaw.rotation.y); // Camera Z after applying yaw.
      pitch.rotation.x = grounded ? 0 : correct(pitchState, Math.atan2(-view.y, depth), rig.pitchDeadzone);
      const angle = flapAngle(rig, pose, seconds); // Mirrored stroke about the two fore-aft axes.
      bones[0].rotation.x = angle;
      bones[1].rotation.x = -angle;
    }

    function dispose() {
      root.parent?.remove(root);
      for (const mesh of [flying, perched, wings]) {
        mesh.geometry.dispose();
        mesh.material.map.dispose();
        mesh.material.dispose();
      }
      wings.skeleton.dispose();
    }

    return { root, update, dispose, pitch, yaw, setPerchSpline, perched };
  }

  window.FlyingAnimalRig = { defaults: DEFAULT, limits, perchPosePadding: PERCH_POSE_PADDING, normalize, normalizePerchSpline, flapAngle, create };
})();
