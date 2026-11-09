// Shared Three.js assembly for two-bone flying animal rigs.
(() => {
  'use strict';

  const DEG = Math.PI / 180; // Authoring angles are in degrees.
  const DEFAULT = Object.freeze({
    "version": 1,
    "flying": "creaturesprites/tzatzul_flying.png",
    "perched": "creaturesprites/tzatzul_perched.png",
    "wings": "creaturesprites/tzatzul_wings.png",
    "leftHinge": 0.435,
    "rightHinge": 0.469,
    "wingScale": 1.41,
    "wingHeight": 0.15,
    "wingOffset": -0.18,
    "wingCenter": 0.451,
    "flapUp": 43,
    "flapDown": 48,
    "flapHz": 2.2,
    "glideAngle": 7,
    "yawDeadzone": 27.5,
    "pitchDeadzone": 22,
    "perchSpline": {
      "beforePoints": [
        {
          "x": 0.12,
          "y": 0.42
        },
        {
          "x": 0.25,
          "y": 0.41666666666666663
        },
        {
          "x": 0.38,
          "y": 0.41333333333333333
        },
        {
          "x": 0.51,
          "y": 0.41000000000000003
        },
        {
          "x": 0.64,
          "y": 0.4066666666666667
        },
        {
          "x": 0.77,
          "y": 0.4033333333333333
        },
        {
          "x": 0.9,
          "y": 0.4
        }
      ],
      "afterPoints": [
        {
          "x": 0.21690159256776786,
          "y": 0.49688129650143487
        },
        {
          "x": 0.32969049320109534,
          "y": 0.5062156881558175
        },
        {
          "x": 0.41539226733126267,
          "y": 0.5948924088724519
        },
        {
          "x": 0.5343979073426857,
          "y": 0.7504657252261289
        },
        {
          "x": 0.6121067955743089,
          "y": 0.8687014749622755
        },
        {
          "x": 0.6649488395718127,
          "y": 1.0211630832032237
        },
        {
          "x": 0.7462100774834645,
          "y": 1.2125181121180668
        }
      ]
    },
    "talonCarry": {
      "socket": {
        "x": 0.02,
        "y": -0.23,
        "z": 0
      },
      "poses": {
        "humanoid": {
          "position": {
            "x": 0.2,
            "y": -0.065,
            "z": 0
          },
          "rotation": {
            "x": -77.75,
            "y": 90,
            "z": 0
          }
        },
        "animal": {
          "position": {
            "x": -0.05,
            "y": 0.05,
            "z": 0
          },
          "rotation": {
            "x": 0,
            "y": 90,
            "z": 0
          }
        },
        "burden": {
          "position": {
            "x": 0.07,
            "y": -0.2,
            "z": 0
          },
          "rotation": {
            "x": 0,
            "y": -90,
            "z": 0
          }
        }
      },
      "birdScale": 2,
      "rotationOrder": "YXZ"
    }
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
    // Preserve the NPC comparison when collapsing legacy per-payload values into one scale.
    const legacyPose = TALON_TYPES.map(type => input?.poses?.[type])
      .find(pose => Number.isFinite(pose?.birdScale) || Number.isFinite(pose?.scale));
    const birdScale = axis(input?.birdScale,
      axis(legacyPose?.birdScale, 1 / axis(legacyPose?.scale, 1, .1, 4), .25, 10), .25, 10);
    const poses = Object.fromEntries(TALON_TYPES.map(type => {
      const pose = input?.poses?.[type];
      let rotation = vector(pose?.rotation, {}, 180);
      if (input?.rotationOrder !== TALON_ROTATION_ORDER && (rotation.x || rotation.y || rotation.z)) {
        // Convert old drafts without changing how their payload was oriented.
        const angles = new window.THREE.Euler(rotation.x * DEG, rotation.y * DEG, rotation.z * DEG, 'XYZ');
        angles.reorder(TALON_ROTATION_ORDER);
        rotation = { x: angles.x / DEG, y: angles.y / DEG, z: angles.z / DEG };
      }
      return [type, { position: vector(pose?.position, {}, 4), rotation }];
    }));
    return { socket, poses, birdScale, rotationOrder: TALON_ROTATION_ORDER };
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
    object.scale.setScalar(1 / carry.birdScale);
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
    const perched = body('perched'); // Folded-wing side profile with its ground pose spline.
    // Keep the grip art in its original pose so the talons stay on the authored socket.
    const gripping = new THREE.Mesh(new THREE.PlaneGeometry(perched.geometry.parameters.width, 1), perched.material);
    gripping.visible = false;
    pitch.add(gripping);
    const eyeMaterial = images.eyes && images.blink ? material('eyes', { depthWrite: false, side: THREE.FrontSide }) : null; // Optional for other flying species and the existing author preview.
    const eyeOpenTexture = eyeMaterial?.map || null; // The authored eye pixels share the full 1617x1000 body canvas.
    const eyeShutTexture = eyeMaterial ? png.makeCanvasTexture(THREE, images.blink, 'flying-animal-eyes-blink') : null; // The same mesh blinks without rebuilding geometry.
    const rearEyeMaterial = eyeMaterial ? png.makeMaterial(THREE, eyeOpenTexture, 'flying-animal-eyes-rear', { depthWrite: false, side: THREE.BackSide }) : null; // Reuse the original PNG and blink texture on the far side, without making a second eye canvas.
    const eyeFlying = eyeMaterial ? new THREE.Mesh(flying.geometry, eyeMaterial) : null; // Each eye plane reuses its body's mesh geometry.
    const eyePerched = eyeMaterial ? new THREE.Mesh(perched.geometry, eyeMaterial) : null;
    const eyeGripping = eyeMaterial ? new THREE.Mesh(gripping.geometry, eyeMaterial) : null;
    const rearEyeFlying = rearEyeMaterial ? new THREE.Mesh(flying.geometry, rearEyeMaterial) : null; // Rear-facing eye art shares the authored flying UVs.
    const rearEyePerched = rearEyeMaterial ? new THREE.Mesh(perched.geometry, rearEyeMaterial) : null; // Both faces inherit the live seven-point shoulder deformation.
    const rearEyeGripping = rearEyeMaterial ? new THREE.Mesh(gripping.geometry, rearEyeMaterial) : null; // Capturing a victim must not hide the eyes seen from below/behind.
    for (const [eye, side] of [
      [eyeFlying, 1], [eyePerched, 1], [eyeGripping, 1],
      [rearEyeFlying, -1], [rearEyePerched, -1], [rearEyeGripping, -1],
    ]) {
      if (!eye) continue;
      eye.position.z = side * .004; // Independent near/far layers prevent body depth from hiding the eyes on the reverse side.
      eye.visible = false;
      eye.userData.flyingAnimalEyeOverlay = true; // The mother's palette must never multiply either eye texture.
      pitch.add(eye);
    }
    function glowOverlay(key, geometry) {
      if (!images[key]) return null; // Optional source-space mask, used only by creatures with authored marker eyes.
      const mesh = new THREE.Mesh(geometry, material(key, {
        depthWrite: false, alphaTest: 0, blending: THREE.AdditiveBlending, toneMapped: false,
      })); // Canonical PNG texture pipeline with additive emissive-looking pixels and a soft, non-occluding halo.
      mesh.position.z = .007; // Above the body and ordinary eye overlays; never z-fight the source art.
      mesh.visible = false;
      mesh.userData.flyingAnimalEyeOverlay = true; // Body tint/flash restores must never recolor the glow as fur.
      pitch.add(mesh);
      return mesh;
    }
    const glowFlying = glowOverlay('glowFlying', flying.geometry); // Same flying geometry preserves the authored eye coordinates.
    const glowPerched = glowOverlay('glowPerched', perched.geometry); // Shared deformed geometry follows the seven-point perch spline.
    function furPatternOverlay(key, geometry) {
      if (!images[key]) return null; // Only planebent skeeri supply an artist-authored darker-fur mask.
      const mesh = new THREE.Mesh(geometry, material(key, {depthWrite:false,alphaTest:0}));
      mesh.position.z = .003; // Above the shaded body but under the separately marked eyes.
      mesh.visible = false;
      mesh.userData.flyingAnimalPatternOverlay = true; // Independent swatch; no impact on ordinary Tzatzul/Pingdort sprites.
      pitch.add(mesh);
      return mesh;
    }
    const patternFlying = furPatternOverlay('patternFlying', flying.geometry); // Authored markings follow flying pose and preserve the same outline.
    const patternPerched = furPatternOverlay('patternPerched', perched.geometry); // Authored markings follow the deformed perch silhouette.
    function setPalette(bodyHex, eyeHex, patternHex) {
      let changed = false; // Used by the live visual owner to restore per-creature colors after damage flashes.
      for (const [meshes, color] of [[[flying, perched, wings], bodyHex], [[glowFlying, glowPerched], eyeHex], [[patternFlying, patternPerched], patternHex]]) {
        if (!/^#[0-9a-f]{6}$/i.test(color || '')) continue;
        for (const mesh of meshes) {
          const pigment = mesh?.material?.color;
          if (!pigment || pigment.getHexString().toLowerCase() === color.slice(1).toLowerCase()) continue;
          pigment.set(color); changed = true;
        }
      }
      return changed;
    }
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

    function update(camera, pose, seconds, carrying = false, blinkShut = false) {
      const grounded = pose === 'perched'; // Perched preview retains only the usual yaw deadzone.
      wings.visible = !grounded;
      flying.visible = !grounded && !carrying;
      gripping.visible = !grounded && carrying;
      perched.visible = grounded;
      if (glowFlying) glowFlying.visible = !grounded && !carrying;
      if (glowPerched) glowPerched.visible = grounded || carrying; // The talon-grip pose reuses the perched body silhouette.
      if (patternFlying) patternFlying.visible = !grounded && !carrying;
      if (patternPerched) patternPerched.visible = grounded || carrying; // No separate talon-grip markings: it shares the perched silhouette.
      if (eyeMaterial) {
        eyeFlying.visible = rearEyeFlying.visible = !grounded && !carrying;
        eyePerched.visible = rearEyePerched.visible = grounded;
        eyeGripping.visible = rearEyeGripping.visible = !grounded && carrying;
        const eyeTexture = blinkShut ? eyeShutTexture : eyeOpenTexture; // Reuse CreatureBlink's individual timer instead of creating a second blink clock.
        if (eyeMaterial.map !== eyeTexture) { eyeMaterial.map = eyeTexture; eyeMaterial.needsUpdate = true; }
        if (rearEyeMaterial.map !== eyeTexture) { rearEyeMaterial.map = eyeTexture; rearEyeMaterial.needsUpdate = true; }
      }
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
      gripping.geometry.dispose(); // The perched mesh owns the shared material.
      if (eyeMaterial) {
        eyeOpenTexture.dispose();
        eyeShutTexture.dispose();
        eyeMaterial.dispose();
        rearEyeMaterial.dispose(); // Six eye meshes share body geometries and two textures; neither is disposed a second time.
      }
      for (const overlay of [glowFlying, glowPerched, patternFlying, patternPerched]) {
        if (!overlay) continue;
        overlay.material.map.dispose();
        overlay.material.dispose(); // Body owns reused geometry; dispose every individual overlay texture/material exactly once.
      }
      wings.skeleton.dispose();
    }

    return { root, update, dispose, pitch, yaw, setPerchSpline, setPalette, perched,
      bodyMaterials: { flying: flying.material, perched: perched.material, wings: wings.material } }; // Live genotype recolors can replace the exact existing pose maps without disturbing the shared gripping mesh.
  }

  window.FlyingAnimalRig = { defaults: DEFAULT, limits, perchPosePadding: PERCH_POSE_PADDING, normalize, normalizePerchSpline, talonTypes: TALON_TYPES, normalizeTalonCarry, placeTalonPayload, flapAngle, create };
})();
