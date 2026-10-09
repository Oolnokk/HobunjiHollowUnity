// Procedural Animation Editor: explicit Pants Rig "Apply to NPC" preview.
// This intentionally has a beltline-only fallback so authors can validate the
// garment-to-body fit before procedural thigh/calf binding is available.
(function () {
  'use strict';

  if (window.ProceduralPantsRigApply?.installed) return;

  const SELF_SCRIPT_SRC = document.currentScript?.src || new URL('procedural-pants-rig-apply.js', window.location.href).href; // Keeps commit-pinned assets on the same revision.
  const BUTTON_ID = 'proceduralPantsApplyToNpc'; // Host-header action requested by the Pants authoring workflow.
  const MESH_NAME = 'ProceduralPantsRigAppliedPreview'; // Distinguishes this explicit static application from the live procedural-leg preview.
  const DEFAULT_GARMENT_ID = 'pants_basic'; // Repository garment currently used by the author.
  const DEFAULT_IMAGE_PATH = 'assets/cosmetics/clothes/legs/pants_basic.png'; // Stored runtime-relative path for the clean pants art.
  const SEGMENTS = 32; // Dense enough that the static leg-thickness warp is visible without creating a heavy preview mesh.
  const DOUBLE_SIDE = 2; // Three.js DoubleSide numeric constant without depending on window.THREE.
  let applied = null; // Owns the current explicitly applied static preview resources.
  let applying = false; // Prevents multiple async texture builds from racing on repeated clicks.

  function hostStatus(message, kind = 'good') {
    const status = document.getElementById('proceduralPantsRigStatus'); // Keeps feedback visible in the Pants panel footer.
    if (status) {
      status.textContent = message;
      status.dataset.kind = kind;
    }
    const pill = document.getElementById('statusPill'); // Mirrors important state to the procedural editor's global mobile-visible status pill.
    if (pill) {
      pill.textContent = message;
      pill.className = kind === 'warn' ? 'pill warn' : 'pill good';
    }
  }

  function authorApi() {
    try {
      return window.ProceduralPantsRigAuthor?.getAuthorFrame?.()?.contentWindow?.__pantsRigAuthorDebug || null;
    } catch (_) {
      return null;
    }
  }

  function normalizeSpecies(value) {
    return String(value || '').trim().toLowerCase().replace(/_/g, '-');
  }

  function normalizeGender(value) {
    return String(value || '').trim().toLowerCase();
  }

  function identityKey(identity) {
    return `${normalizeSpecies(identity?.speciesId)}::${normalizeGender(identity?.gender)}`;
  }

  function currentIdentity() {
    const selected = window.HobunjiGameplayBackdrop?.getSelectedNpc?.(); // Prefers the exact NPC currently shown in Procedural Animation.
    const appearance = selected?.appearance || {};
    const speciesId = appearance.speciesId || selected?.speciesId || selected?.species || selected?.fighter?.speciesId;
    const gender = appearance.gender || selected?.gender || selected?.fighter?.gender;
    if (speciesId && gender) return { speciesId, gender };
    const fighter = authorApi()?.state?.()?.fighter; // Falls back to the embedded author's current canonical species/gender selection.
    return fighter ? { speciesId: fighter.speciesId || fighter.id, gender: fighter.gender } : null;
  }

  function currentGarmentId() {
    return String(authorApi()?.state?.()?.garmentId || DEFAULT_GARMENT_ID);
  }

  function findPortraitPlane(model) {
    let preferred = null; // Uses the same front/skinned portrait preference as the live Pants preview.
    let fallback = null;
    model?.traverse?.(node => {
      if (!node?.isMesh || node.userData?.hobunjiPantsPreview || node.userData?.hobunjiAppliedPantsPreview) return;
      if (!fallback && node.geometry) fallback = node;
      const face = String(node.userData?.hobunjiPlaneFace || '').toLowerCase();
      const name = String(node.name || '').toLowerCase();
      if (!preferred && (face === 'front' || /front.*plane|plane.*front/.test(name) || node.isSkinnedMesh)) preferred = node;
    });
    return preferred || fallback;
  }

  function constructorNamed(instance, name) {
    let proto = instance; // Walks the native Three prototype chain because the procedural editor does not publish window.THREE.
    while (proto) {
      const ctor = proto.constructor;
      if (ctor?.name === name) return ctor;
      proto = Object.getPrototypeOf(proto);
    }
    return null;
  }

  function deriveRuntime(model, plane) {
    if (!model || !plane?.geometry) return null;
    const Vector3 = model.position?.constructor;
    const BufferGeometry = constructorNamed(plane.geometry, 'BufferGeometry') || plane.geometry.constructor;
    const sourcePosition = plane.geometry.getAttribute?.('position');
    const BufferAttribute = constructorNamed(sourcePosition, 'BufferAttribute') || sourcePosition?.constructor;
    let meshSample = null;
    model.traverse?.(node => {
      if (!meshSample && node?.isMesh && !node?.isSkinnedMesh && !node.userData?.hobunjiPantsPreview && !node.userData?.hobunjiAppliedPantsPreview) meshSample = node;
    });
    let Mesh = meshSample?.constructor || null;
    if (!Mesh && plane.isSkinnedMesh) Mesh = Object.getPrototypeOf(plane.constructor?.prototype || null)?.constructor || null;
    if (!Mesh) Mesh = plane.constructor;
    const materials = Array.isArray(plane.material) ? plane.material : [plane.material];
    const sourceMaterial = materials.find(material => material?.map) || materials.find(Boolean) || null;
    const sourceTexture = sourceMaterial?.map || null;
    if (![Vector3, BufferGeometry, BufferAttribute, Mesh, sourceMaterial, sourceTexture].every(Boolean)) return null;
    return { Vector3, BufferGeometry, BufferAttribute, Mesh, sourceMaterial, sourceTexture };
  }

  function portraitDimensions(model, plane) {
    const parameters = plane?.geometry?.parameters || {};
    const width = Number(model?.userData?.portraitModelWidth) || Number(parameters.width) || 0.9;
    const height = Number(model?.userData?.portraitModelHeight) || Number(parameters.height) || width;
    return { width: Math.max(0.05, width), height: Math.max(0.05, height) };
  }

  function forwardStaticFit(Core, garment, character, point) {
    const controls = Core.buildLegOpeningFitControls(garment, Number(character?.legThickness) || 1); // Same one-time thickness warp used by the 2D author and live preview.
    const displacement = Core.inverseDistanceDisplacement(point, controls.source, controls.target, 2);
    return { x: Core.clamp(point.x + displacement.x), y: Core.clamp(point.y + displacement.y) };
  }

  function beltMappedPoint(Core, transform, garment, character, fittedPoint) {
    const affinePoint = Core.applyAffine(transform, fittedPoint); // Broad pants-space -> portrait-space placement.
    const mappedBelt = garment.pantsBeltSpline.map(point => Core.applyAffine(transform, point)); // Affine positions of the five garment belt anchors.
    const residual = Core.inverseDistanceDisplacement(affinePoint, mappedBelt, character.portraitBeltSpline, 2); // Pulls the mapped waist toward all five authored body belt anchors rather than trusting a single scale/rotation alone.
    return {
      x: Core.clamp(affinePoint.x + residual.x),
      y: Core.clamp(affinePoint.y + residual.y),
    };
  }

  function createGeometry(Runtime, Core, model, plane, garment, character) {
    const transform = Core.solveAffine(garment?.pantsBeltSpline, character?.portraitBeltSpline);
    if (!transform) return null;
    const dimensions = portraitDimensions(model, plane);
    const resolver = window.PNGPlaneAvatar?.resolveSkinnedPixelWorldPosition; // When available, uses the same CPU-skinned portrait pixel resolver as the intended game runtime belt anchors.
    const positions = new Float32Array((SEGMENTS + 1) * (SEGMENTS + 1) * 3);
    const uvs = new Float32Array((SEGMENTS + 1) * (SEGMENTS + 1) * 2);
    const indices = [];
    const localPoint = new Runtime.Vector3();
    const worldPoint = new Runtime.Vector3();
    model.updateMatrixWorld?.(true);
    plane.updateMatrixWorld?.(true);
    let vertex = 0;
    for (let row = 0; row <= SEGMENTS; row++) {
      const v = row / SEGMENTS;
      for (let col = 0; col <= SEGMENTS; col++, vertex++) {
        const u = col / SEGMENTS;
        const fitted = forwardStaticFit(Core, garment, character, { x: u, y: v });
        const portrait = beltMappedPoint(Core, transform, garment, character, fitted);
        let local = null;
        if (typeof resolver === 'function') {
          const resolved = resolver(model, { x: portrait.x * 199, y: portrait.y * 199 }); // Matches PantsRigRuntime's canonical 200px portrait coordinate convention.
          if (resolved) {
            worldPoint.set(resolved.x, resolved.y, resolved.z);
            local = model.worldToLocal(worldPoint.clone());
            local.z += 0.014; // Keeps the applied pants fractionally in front of the body plane to avoid z-fighting.
          }
        }
        if (!local) {
          localPoint.set((portrait.x - 0.5) * dimensions.width, (0.5 - portrait.y) * dimensions.height, 0.014);
          worldPoint.copy(localPoint);
          plane.localToWorld(worldPoint);
          local = model.worldToLocal(worldPoint);
        }
        positions[vertex * 3] = local.x;
        positions[vertex * 3 + 1] = local.y;
        positions[vertex * 3 + 2] = local.z;
        uvs[vertex * 2] = u;
        uvs[vertex * 2 + 1] = 1 - v;
      }
    }
    for (let row = 0; row < SEGMENTS; row++) {
      for (let col = 0; col < SEGMENTS; col++) {
        const a = row * (SEGMENTS + 1) + col;
        const b = a + 1;
        const c = a + SEGMENTS + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new Runtime.BufferGeometry();
    geometry.setAttribute('position', new Runtime.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new Runtime.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  function garmentSourceUrl(garment) {
    const path = String(garment?.image || DEFAULT_IMAGE_PATH).trim() || DEFAULT_IMAGE_PATH;
    if (/^https?:/i.test(path)) return path;
    if (path.startsWith('assets/')) return new URL(`../${path}`, SELF_SCRIPT_SRC).href;
    return new URL('../assets/cosmetics/clothes/legs/pants_basic.png', SELF_SCRIPT_SRC).href;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load pants texture ${url}`));
      image.src = url;
    });
  }

  function clearEdgeDarkBackground(canvas, threshold) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = image.data;
    const count = canvas.width * canvas.height;
    const visited = new Uint8Array(count);
    const queue = new Int32Array(count);
    let head = 0;
    let tail = 0;
    const enqueue = index => {
      if (index < 0 || index >= count || visited[index]) return;
      visited[index] = 1;
      const offset = index * 4;
      if (pixels[offset + 3] === 0) return;
      if (pixels[offset] > threshold || pixels[offset + 1] > threshold || pixels[offset + 2] > threshold) return;
      queue[tail++] = index;
    };
    for (let x = 0; x < canvas.width; x++) {
      enqueue(x);
      enqueue((canvas.height - 1) * canvas.width + x);
    }
    for (let y = 0; y < canvas.height; y++) {
      enqueue(y * canvas.width);
      enqueue(y * canvas.width + canvas.width - 1);
    }
    while (head < tail) {
      const index = queue[head++];
      pixels[index * 4 + 3] = 0;
      const x = index % canvas.width;
      if (x > 0) enqueue(index - 1);
      if (x + 1 < canvas.width) enqueue(index + 1);
      if (index >= canvas.width) enqueue(index - canvas.width);
      if (index + canvas.width < count) enqueue(index + canvas.width);
    }
    context.putImageData(image, 0, 0);
  }

  async function cleanTextureCanvas(url) {
    const image = await loadImage(url);
    const maxDimension = 1024; // Applied preview does not need the source's full authoring resolution and stays lighter on mobile.
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const authorDocument = window.ProceduralPantsRigAuthor?.getAuthorFrame?.()?.contentDocument;
    const shouldClear = authorDocument?.getElementById('clearBlack')?.checked !== false; // Mirrors the 2D author's edge-background setting.
    const threshold = Math.max(0, Math.min(40, Number(authorDocument?.getElementById('blackThreshold')?.value) || 10));
    if (shouldClear) clearEdgeDarkBackground(canvas, threshold);
    return canvas;
  }

  function disposeApplied() {
    if (!applied) return;
    applied.mesh?.removeFromParent?.();
    applied.geometry?.dispose?.();
    applied.material?.dispose?.();
    applied.texture?.dispose?.();
    applied = null;
  }

  async function applyToNpc() {
    if (applying) return false;
    applying = true;
    try {
      const backdrop = window.HobunjiGameplayBackdrop;
      if (backdrop?.getPreviewMode?.() === 'creature') {
        hostStatus('Apply pants is only available for humanoid NPC/player portraits.', 'warn');
        return false;
      }
      const model = backdrop?.getAvatarModel?.();
      const identity = currentIdentity();
      const api = authorApi();
      const Core = window.HobunjiPantsRig;
      const project = api?.exportProject?.();
      if (!model || !identity || !Core || !project) {
        hostStatus('Apply pants is waiting for the NPC and Pants Rig author data.', 'warn');
        return false;
      }
      const garmentId = currentGarmentId();
      const garment = project.garments?.[garmentId] || project.garments?.[DEFAULT_GARMENT_ID] || Object.values(project.garments || {})[0];
      const character = project.characters?.[identityKey(identity)];
      if (!garment || !character) {
        hostStatus(`Mark the ${identityKey(identity)} portrait beltline before applying pants.`, 'warn');
        return false;
      }
      const plane = findPortraitPlane(model);
      const Runtime = deriveRuntime(model, plane);
      if (!plane || !Runtime) {
        hostStatus('Could not find the current NPC portrait plane/native preview constructors.', 'warn');
        return false;
      }

      const live = document.getElementById('proceduralPantsLive3d'); // Avoids duplicate garments: explicit Apply owns the visible mesh until Live 3D is re-enabled.
      if (live?.checked) {
        live.checked = false;
        live.dispatchEvent(new Event('change', { bubbles: true }));
      }

      hostStatus('Applying pants to the current NPC beltline…', 'good');
      const geometry = createGeometry(Runtime, Core, model, plane, garment, character);
      if (!geometry) {
        hostStatus('Could not solve the authored pants ↔ portrait beltline mapping.', 'warn');
        return false;
      }
      const cleanCanvas = await cleanTextureCanvas(garmentSourceUrl(garment));
      const texture = Runtime.sourceTexture.clone();
      texture.image = cleanCanvas;
      texture.needsUpdate = true;
      const material = Runtime.sourceMaterial.clone();
      material.map = texture;
      material.transparent = true;
      material.alphaTest = 0.01;
      material.side = DOUBLE_SIDE;
      material.depthWrite = false;
      material.polygonOffset = true;
      material.polygonOffsetFactor = -3;
      material.polygonOffsetUnits = -3;
      if ('skinning' in material) material.skinning = false;
      material.color?.set?.(0xffffff);
      material.needsUpdate = true;
      const mesh = new Runtime.Mesh(geometry, material);
      mesh.name = MESH_NAME;
      mesh.renderOrder = 30;
      mesh.frustumCulled = false;
      mesh.userData.hobunjiAppliedPantsPreview = true;
      mesh.userData.pantsRig = { garmentId, characterKey: identityKey(identity), mode: 'static-beltline-apply' };

      disposeApplied();
      model.add(mesh);
      model.updateMatrixWorld?.(true);
      applied = { model, mesh, geometry, material, texture, garmentId, characterKey: identityKey(identity) };
      hostStatus('Pants applied to this NPC: five-point garment belt mapped to the authored species beltline. Live leg deformation is optional.', 'good');
      return true;
    } catch (error) {
      hostStatus(`Apply pants failed: ${error?.message || error}`, 'warn');
      console.error('[Pants Rig Apply]', error);
      return false;
    } finally {
      applying = false;
    }
  }

  function installButton() {
    const tools = document.querySelector('#proceduralPantsRigPanel .pantsRigHostTools');
    if (!tools || document.getElementById(BUTTON_ID)) return false;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = 'Apply to NPC';
    button.title = 'Apply the authored pants to the current NPC using the five-point pants and species beltlines';
    button.addEventListener('click', () => applyToNpc());
    const rebind = document.getElementById('proceduralPantsRebind');
    tools.insertBefore(button, rebind || tools.lastElementChild || null);
    return true;
  }

  function waitForPanel() {
    if (installButton()) return;
    const started = performance.now();
    const retry = () => {
      if (installButton()) return;
      if (performance.now() - started < 12000) requestAnimationFrame(retry);
    };
    requestAnimationFrame(retry);
  }

  window.addEventListener('hobunji-backdrop-npc-changed', () => {
    if (applied?.model && applied.model !== window.HobunjiGameplayBackdrop?.getAvatarModel?.()) disposeApplied(); // Never leaves an explicit preview attached to a stale NPC model.
  });

  window.ProceduralPantsRigApply = Object.freeze({
    installed: true,
    apply: applyToNpc,
    remove: disposeApplied,
    getMesh: () => applied?.mesh || null,
    debugSnapshot: () => ({
      applied: !!applied,
      garmentId: applied?.garmentId || null,
      characterKey: applied?.characterKey || null,
      modelName: applied?.model?.name || null,
      meshName: applied?.mesh?.name || null,
      liveProceduralPreviewDisabledOnApply: true,
    }),
  });

  waitForPanel();
})();
