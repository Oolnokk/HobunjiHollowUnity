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
  let display = null; // Shared belt sprite exposes the same authored idle-scale multiplier used by the held torch.

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
  function ensureRoot(THREE) {
    if (root) return root;
    const factory = global.HobunjiBeltStowRig?.createTorchDisplay; // Single authored PNG/particle geometry used by gameplay and Rig Coordinates.
    const preview = factory?.(THREE);
    if (!preview) { placement = 'shared belt art unavailable'; return null; }
    display = preview;
    root = preview.root;
    art = preview.art;
    flame = preview.flame;
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
    const configured = global.HobunjiBeltStowRig?.configuredSnapshot(
      global.HOBUNJI_ATTACHMENT_RIG_PROFILES, species, gender); // Explicit Rig Coordinates placement supersedes the automatic waist spline.
    if (configured && global.HobunjiBeltStowRig.placeRoot(root, configured)) {
      placement = 'authored species/gender belt-stow rig';
      return;
    }
    root.scale?.set?.(1, 1, 1); // Clear an older authored transform if the species/profile changed during a live rebuild.
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
    if (!ensureRoot(THREE)) return;
    if (root.parent !== body) body.add(root); // Avatar and mount transitions never leave the old belt copy in the old scene.
    const burning = torch.isLit(); // Always query the authoritative 30-second flame clock before showing a belt copy.
    const stowed = burning && !torch.isHoldingTorch();
    root.visible = stowed;
    if (flame) flame.visible = stowed;
    if (!stowed) return; // Unlit, burned-out, and thrown torches stay invisible; the flame timer continues independently.
    const idleScale = Number(global.WeaponToolStances?.poses?.torchHold?.scale ?? global.HeldActionAnimations?.torchIdle?.poses?.neutral?.scale) || 1; // Shared authored torch Neutral scale, including local editor overrides.
    display?.setIdleScale?.(idleScale); // Scales around the handle end, matching the held tool's grip-anchored idle animation.
    updateTexture(THREE);
    positionOnBelt(THREE, body, Number(frame.timestamp) || performance.now());
    if (flame) {
      const t = (Number(frame.timestamp) || performance.now()) / 1000;
      const scale = display?.idleScale || 1; // Uses the actual clamped artwork scale for the decorative flame.
      flame.scale.set(.13 * scale * (1 + .07 * Math.sin(t * 13)), .23 * scale * (1 + .08 * Math.sin(t * 11)), 1);
    } // Decorative flame is independent of held-fire particles; the 30s state remains authoritative.
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
        idleScale: display?.idleScale || 1, // Mobile Pixel Probe compares belt sizing with the authored Neutral stance.
      };
    },
  });
  global.RuntimeFrameScheduler?.register?.('adventuring-torch-belt', sync, {
    phase: 'pre-render', owner: 'AdventuringTorchBelt',
    description: 'Reuses the held torch PNG at the animated hip; one flame lifetime and one cheap belt billboard.',
  });
})(window);
