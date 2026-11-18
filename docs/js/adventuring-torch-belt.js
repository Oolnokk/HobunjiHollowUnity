// A single lightweight stowed display of the Adventuring Tools torch.
// The actual flame lifetime remains in AdventuringTools; this module owns only artwork.
(function (global) {
  'use strict';
  if (global.AdventuringTorchBelt) return;

  const SAMPLE_INTERVAL_MS = 100; // Sample authored animated waist anchors at 10 Hz, not every frame.
  const FALLBACK_SPRITE = 'assets/toolsprites/torch.png'; // Used only until the actual held tool sprite is available.
  let root = null; // One belt display, reparented when the player's mesh is rebuilt.
  let art = null; // Reuses the actual held torch's PNG material when it loads.
  let flame = null; // One simple billboard flame; no extra lights, shadows or particle emitters.
  let fallbackTexture = null; // Shared single fallback load for a torch that has never been equipped.
  let lastSampleAt = -Infinity; // Throttles expensive five-point skinning against the real waist.
  let placement = 'not ready'; // Mobile Pixel Probe reports actual positioning provenance.

  function playerBody() {
    return global.PlayerBodyTransformComposer?.getPlayerMesh?.()
      || global.ProceduralHandAttachments?.gameDeps?.playerMesh
      || global.Combat?.deps?.playerMesh || null;
  }
  function equippedPlane() {
    const deps = global.ProceduralHandAttachments?.gameDeps || global.Combat?.deps;
    return deps?.toolMeshMap?.adventuring?.userData?.toolPlane || null;
  }
  function materialMap(material) {
    const parts = Array.isArray(material) ? material : [material];
    return parts.find(part => part?.map)?.map || null;
  }
  function makeFlameTexture(THREE) {
    const canvas = document.createElement('canvas'); // One tiny procedurally drawn flame, not a moving geometry pool.
    canvas.width = 32; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const gradient = ctx.createLinearGradient(0, 6, 0, 59);
    gradient.addColorStop(0, 'rgba(255,238,160,0)');
    gradient.addColorStop(.24, 'rgba(255,239,175,0.9)');
    gradient.addColorStop(.65, 'rgba(255,157,42,0.95)');
    gradient.addColorStop(1, 'rgba(255,71,12,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(16, 2);
    ctx.bezierCurveTo(23, 22, 28, 32, 26, 47);
    ctx.bezierCurveTo(25, 60, 7, 62, 6, 47);
    ctx.bezierCurveTo(5, 32, 13, 22, 16, 2);
    ctx.fill();
    const texture = new THREE.CanvasTexture(canvas); // Shared by the belt's one flame sprite.
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    return texture;
  }
  function ensureRoot(THREE) {
    if (root) return root;
    root = new THREE.Group(); root.name = 'adventuring_torch_belt';
    root.userData.adventuringTorchBelt = true; // Marks it as decorative, never a held weapon or collider.
    const material = new THREE.MeshBasicMaterial({
      transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    }); // Populated from the held plane; no extra PNG decode in the normal case.
    art = new THREE.Mesh(new THREE.PlaneGeometry(.17, .38), material);
    art.name = 'stowed_torch_png';
    art.rotation.z = Math.PI; // The authored torch PNG's flame tip is local -Y.
    art.renderOrder = 2.32;
    art.raycast = () => {}; // Belt decoration must never steal world-object taps.
    root.add(art);
    const fireTexture = makeFlameTexture(THREE);
    if (fireTexture) {
      flame = new THREE.Sprite(new THREE.SpriteMaterial({
        map: fireTexture, transparent: true, depthTest: true, depthWrite: false,
        blending: THREE.AdditiveBlending, color: 0xffffff,
      }));
      flame.name = 'stowed_torch_flame';
      flame.position.set(0, .24, .035);
      flame.scale.set(.13, .23, 1);
      flame.renderOrder = 2.34;
      flame.raycast = () => {}; // Flame has no gameplay collision or fire-hazard contact.
      root.add(flame);
    }
    return root;
  }
  function updateTexture(THREE) {
    if (!art) return;
    const sourceMap = materialMap(equippedPlane()?.material);
    if (sourceMap && art.material.map !== sourceMap) {
      art.material.map = sourceMap; art.material.needsUpdate = true;
    } else if (!sourceMap && !art.material.map && !fallbackTexture) {
      fallbackTexture = new THREE.TextureLoader().load(FALLBACK_SPRITE, texture => {
        global.HobunjiSpritePngSurface?.configureTexture?.(THREE, texture, FALLBACK_SPRITE);
        if (art && !art.material.map) { art.material.map = texture; art.material.needsUpdate = true; }
      }, undefined, error => global.__farmLog?.('[torch belt] Torch PNG load failed: ' + error, 'warn'));
    }
    if (!sourceMap && fallbackTexture && !art.material.map) {
      art.material.map = fallbackTexture; art.material.needsUpdate = true;
    }
  }
  function belongsToBody(node, body) {
    for (let cursor = node; cursor; cursor = cursor.parent) if (cursor === body) return true;
    return false;
  }
  function positionOnBelt(THREE, body, timestamp) {
    if (timestamp - lastSampleAt < SAMPLE_INTERVAL_MS) return;
    lastSampleAt = timestamp;
    const height = Number(body.userData?.portraitModelHeight) || .9; // Species size keeps the default waist guess proportional.
    const posterior = Number(global.PlayerBodyTransformComposer?.getPosteriorY?.()); // Existing waist-height source used by back-stowed Burdens.
    root.position.set(.22 * height, Number.isFinite(posterior) && posterior !== 0 ? posterior : .50 * height, .10 * height);
    placement = 'posterior fallback';
    const avatar = global.WorldPortraitLife?.getPlayerAvatar?.()?.group || null;
    const pants = global.PantsRigRuntime;
    const species = String(body.userData?.speciesId || body.userData?.species || 'mao-ao').toLowerCase();
    const gender = String(body.userData?.gender || 'male').toLowerCase();
    const record = pants?.characterRecord?.(species, gender);
    if (avatar && belongsToBody(avatar, body) && record && pants.resolveLiveBeltWorldPoints && body.worldToLocal) {
      const points = pants.resolveLiveBeltWorldPoints(avatar, record); // Uses the character's actual animated waist, not guessed trousers scale.
      if (points?.length === 5 && points.every(point => Number.isFinite(point?.x) && Number.isFinite(point?.y) && Number.isFinite(point?.z))) {
        body.updateWorldMatrix?.(true, false);
        const local = points.map(point => body.worldToLocal(new THREE.Vector3(point.x, point.y, point.z)));
        const right = local.reduce((best, point) => point.x > best.x ? point : best);
        root.position.set(right.x + .025 * height, right.y, right.z + .075 * height);
        placement = 'animated pants-belt spline';
      }
    }
    root.rotation.set(0, 0, -.12); // A slight inward cant holds the handle against the wearer's hip.
  }
  function sync(frame = {}) {
    const torch = global.AdventuringTools;
    torch?.updateBurn?.(); // Expiry runs even while held; a belt is not required for the burn clock.
    const body = playerBody();
    if (!torch || !body || !global.THREE) {
      if (root) root.visible = false;
      return;
    }
    const THREE = global.THREE;
    ensureRoot(THREE);
    if (root.parent !== body) body.add(root); // Avatar and mount transitions never leave the old belt copy in the old scene.
    const stowed = !torch.isHoldingTorch();
    root.visible = stowed;
    if (!stowed) return; // The real held torch is the only visible copy while drawn.
    updateTexture(THREE);
    positionOnBelt(THREE, body, Number(frame.timestamp) || performance.now());
    const burning = torch.isLit();
    if (flame) {
      flame.visible = burning;
      if (burning) {
        const t = (Number(frame.timestamp) || performance.now()) / 1000;
        flame.scale.set(.13 * (1 + .07 * Math.sin(t * 13)), .23 * (1 + .08 * Math.sin(t * 11)), 1);
      }
    }
  }

  global.AdventuringTorchBelt = Object.freeze({
    sync,
    get debug() {
      return {
        visible: !!root?.visible && !!root.parent,
        attachedToPlayer: !!root && root.parent === playerBody(),
        fireVisible: !!flame?.visible && !!root?.visible,
        textureReady: !!art?.material?.map?.image,
        placement,
      };
    },
  });
  global.RuntimeFrameScheduler?.register?.('adventuring-torch-belt', sync, {
    phase: 'pre-render', owner: 'AdventuringTorchBelt',
    description: 'Reuses the held torch PNG at the animated hip; one flame lifetime and one cheap belt billboard.',
  });
})(window);
