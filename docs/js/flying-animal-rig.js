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
    perchSpline: {
      beforePoints: [
        { x: 0.12, y: 0.42 },
        { x: 0.25, y: 0.41666666666666663 },
        { x: 0.38, y: 0.41333333333333333 },
        { x: 0.51, y: 0.41000000000000003 },
        { x: 0.64, y: 0.4066666666666667 },
        { x: 0.77, y: 0.4033333333333333 },
        { x: 0.9, y: 0.4 },
      ],
      afterPoints: [
        { x: 0.21690159256776786, y: 0.49688129650143487 },
        { x: 0.32969049320109534, y: 0.5062156881558175 },
        { x: 0.41539226733126267, y: 0.5948924088724519 },
        { x: 0.5343979073426857, y: 0.7504657252261289 },
        { x: 0.6121067955743089, y: 0.8687014749622755 },
        { x: 0.6649488395718127, y: 1.0211630832032237 },
        { x: 0.7462100774834645, y: 1.2125181121180668 },
      ],
    },
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
    const rig = { ...DEFAULT };
    delete rig.perchSpline; // Independent settings for this assembly.
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
    if (input.talonCarry !== undefined) rig.talonCarry = normalizeTalonCarry(input.talonCarry);
    return rig;
  }

  const TALON_TYPES = ['humanoid', 'animal', 'burden']; // Independent poses share the carrier's grip frame.

  const TALON_ROTATION_ORDER = 'YXZ'; // Yaw, then pitch and roll. Yaw at 90° keeps X and Z independent.

  function normalizeTalonCarry(input = {}) {
    const axis = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
    const vector = (value, fallback, limit) => Object.fromEntries(['x', 'y', 'z'].map(key =>
      [key, axis(value?.[key], fallback[key] ?? 0, -limit, limit)]));
    const socket = vector(input?.socket, { x: .02, y: -.23 }, 4);
    const poses = Object.fromEntries(TALON_TYPES.map(type => {
      const pose = input?.poses?.[type];
      let rotation = vector(pose?.rotation, {}, 180);
      if (input?.rotationOrder !== TALON_ROTATION_ORDER && (rotation.x || rotation.y || rotation.z)) {
        // Convert old drafts without changing how their payload was oriented.
        const angles = new window.THREE.Euler(rotation.x * DEG, rotation.y * DEG, rotation.z * DEG, 'XYZ');
        angles.reorder(TALON_ROTATION_ORDER);
        rotation = { x: angles.x / DEG, y: angles.y / DEG, z: angles.z / DEG };
      }
      return [type, { position: vector(pose?.position, {}, 4), rotation,
        birdScale: axis(pose?.birdScale, 1 / axis(pose?.scale, 1, .1, 4), .25, 10) }];
    }));
    return { socket, poses, rotationOrder: TALON_ROTATION_ORDER };
  }

  // Match the Furniture Editor's object-local hold anchor to the authored talon pose.
  // The posterior offset is for a humanoid carrier. Talon clearance is authored per pose.
  function placeTalonPayload(frame, object, carry, type, anchor) {
    const pose = carry.poses[type];
    frame.position.set(...['x', 'y', 'z'].map(key => carry.socket[key] + pose.position[key]));
    frame.rotation.set(pose.rotation.x * DEG, pose.rotation.y * DEG, pose.rotation.z * DEG, TALON_ROTATION_ORDER);
    object.rotation.set((anchor?.rotation?.x || 0) * DEG, (anchor?.rotation?.y || 0) * DEG,
      (anchor?.rotation?.z || 0) * DEG, 'XYZ');
    object.quaternion.invert();
    // The frame inherits bird scale. Cancel it on the payload so only the carrier grows.
    object.scale.setScalar(1 / (pose.birdScale * Math.max(.1, anchor?.size || 1)));
    object.position.set(anchor?.position?.x || 0, anchor?.position?.y || 0, anchor?.position?.z || 0)
      .multiplyScalar(-object.scale.x).applyQuaternion(object.quaternion);
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

  window.FlyingAnimalRig = { defaults: DEFAULT, limits, perchPosePadding: PERCH_POSE_PADDING, normalize, normalizePerchSpline, talonTypes: TALON_TYPES, normalizeTalonCarry, placeTalonPayload, flapAngle, create };
})();
