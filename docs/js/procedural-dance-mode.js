// Procedural Animation Editor: Dance loader + canonical editor leg-bone / generated-foot adapters.
(function () {
  'use strict';

  const SELF_SCRIPT_SRC = document.currentScript?.src || ''; // Keeps every Dance adapter on the same branch/commit as this loader.
  const CORE_SCRIPT_ID = 'proceduralDanceModeCoreScript'; // Prevents duplicate Dance-core execution if the adapter is evaluated twice.
  const GENERATED_RIG_SUFFIX = '_procedural_feet'; // Matches the runtime hierarchy name Dance already knows how to consume.

  function updateVisibleStatus(message, good = true) {
    const status = document.getElementById('statusPill');
    if (!status) return;
    status.textContent = message;
    status.className = good ? 'pill good' : 'pill warn';
  }

  function installCanonicalEditorLegBoneToggle() {
    const previousApi = window.ProceduralLegAnimation;
    if (previousApi?.setShowBones && !previousApi.__editorBoneGuideBridge && !previousApi.__editorCanonicalBoneToggle) return;
    let requestedVisible = false;
    let lastVerification = { requested: false, exists: false, visible: false };
    const editorCheckbox = () => document.getElementById('animationLegBonesEnabled');
    const canonicalRoot = () => window.HobunjiGameplayBackdrop?.getScene?.()?.getObjectByName?.('LegBonesDebug') || null;

    function verifyCanonicalState() {
      const root = canonicalRoot();
      lastVerification = { requested: requestedVisible, exists: !!root, visible: !!root?.visible };
      if (!requestedVisible) return updateVisibleStatus(root ? 'Leg bones hidden: editor LegBonesDebug.' : 'Leg bones hidden; waiting for editor leg rig.');
      if (!root) return updateVisibleStatus('Leg bones requested, but editor LegBonesDebug has not been built yet.', false);
      updateVisibleStatus(root.visible ? 'Leg bones shown: editor LegBonesDebug.' : 'Leg bones requested, but editor LegBonesDebug is still hidden.', !!root.visible);
    }

    function setEditorCheckbox(desired) {
      const input = editorCheckbox();
      if (!input) {
        updateVisibleStatus('Leg bones: editor checkbox is not ready yet.', false);
        return false;
      }
      if (input.checked === desired) input.checked = !desired;
      input.click();
      return input.checked === desired;
    }

    function bindCanonicalCheckbox() {
      const input = editorCheckbox();
      if (!input || input.dataset.danceBoneToggleBound === 'true') return;
      input.dataset.danceBoneToggleBound = 'true';
      input.addEventListener('change', () => {
        requestedVisible = !!input.checked;
        requestAnimationFrame(verifyCanonicalState);
      });
    }

    window.ProceduralLegAnimation = {
      __editorCanonicalBoneToggle: true,
      setShowBones(show) {
        requestedVisible = !!show;
        bindCanonicalCheckbox();
        if (!setEditorCheckbox(requestedVisible)) return;
        requestAnimationFrame(() => requestAnimationFrame(verifyCanonicalState));
      },
      get showBones() { return requestedVisible; },
    };
    window.HobunjiEditorLegBoneGuides = {
      get visible() { return lastVerification.visible; },
      get available() { return lastVerification.exists; },
      get requested() { return lastVerification.requested; },
      source: 'LegBonesDebug',
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindCanonicalCheckbox, { once: true });
    else bindCanonicalCheckbox();
    console.info('[Dance bones] Dance delegates visibility to the editor canonical LegBonesDebug visualizer.');
  }

  function installEditorGeneratedFeetDanceBridge() {
    let activeModel = null;
    let shimRoot = null;
    let realFeetRoot = null;
    let legDebugRoot = null;

    function clearShim() {
      shimRoot?.removeFromParent?.();
      shimRoot = null;
      activeModel = null;
      realFeetRoot = null;
      legDebugRoot = null;
    }

    function lineForSide(root, side) {
      const lines = root?.children?.filter?.(node => node?.isLine) || [];
      const wanted = side === 'left' ? 0x5ec8ff : 0xffa15e;
      return lines.find(line => line.material?.color?.getHex?.() === wanted) || lines[side === 'left' ? 0 : 1] || null;
    }

    function readLinePoint(line, index, out) {
      const position = line?.geometry?.attributes?.position;
      if (!position || position.count <= index) return false;
      out.set(position.getX(index), position.getY(index), position.getZ(index));
      return true;
    }

    function findExperimentalFeetRoot(canonicalRoot) {
      const locomotionRoot = canonicalRoot?.parent;
      return locomotionRoot?.children?.find?.(node => /_ExperimentalFeet$/i.test(String(node?.name || '')) || node?.userData?.experimentalFeet) || null;
    }

    function findRealFeet(root) {
      const children = root?.children || [];
      let left = children.find(node => /_LeftFoot$/i.test(String(node?.name || ''))) || null;
      let right = children.find(node => /_RightFoot$/i.test(String(node?.name || ''))) || null;
      if ((!left || !right) && children.length >= 2) {
        const ordered = [...children].sort((a, b) => (Number(a?.position?.x) || 0) - (Number(b?.position?.x) || 0));
        left ||= ordered[0];
        right ||= ordered[ordered.length - 1];
      }
      return left && right ? { left, right } : null;
    }

    function makeSideProxy(THREE, realFoot, line) {
      const data = {
        realFoot,
        line,
        hipPosition: new THREE.Vector3(),
        thighQuaternion: new THREE.Quaternion(),
        calfLocalQuaternion: new THREE.Quaternion(),
        thighLength: 0,
      };

      function refreshHipAndThigh() {
        if (!shimRoot || !data.line) return false;
        const hipLine = new THREE.Vector3();
        const kneeLine = new THREE.Vector3();
        if (!readLinePoint(data.line, 0, hipLine) || !readLinePoint(data.line, 1, kneeLine)) return false;
        data.line.updateMatrixWorld?.(true);
        shimRoot.updateMatrixWorld?.(true);
        const hipLocal = shimRoot.worldToLocal(data.line.localToWorld(hipLine.clone()));
        const kneeLocal = shimRoot.worldToLocal(data.line.localToWorld(kneeLine.clone()));
        data.hipPosition.copy(hipLocal);
        const direction = kneeLocal.sub(hipLocal);
        if (direction.lengthSq() > 1e-10) data.thighQuaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction.normalize());
        return true;
      }

      function writeCanonicalLine(hipLocal, kneeLocal, footLocal) {
        const positions = data.line?.geometry?.attributes?.position;
        if (!positions || positions.count < 3 || !shimRoot) return;
        shimRoot.updateMatrixWorld?.(true);
        data.line.updateMatrixWorld?.(true);
        const toLineLocal = point => data.line.worldToLocal(shimRoot.localToWorld(point.clone()));
        const hip = toLineLocal(hipLocal);
        const knee = toLineLocal(kneeLocal);
        const foot = toLineLocal(footLocal);
        positions.setXYZ(0, hip.x, hip.y, hip.z);
        positions.setXYZ(1, knee.x, knee.y, knee.z);
        positions.setXYZ(2, foot.x, foot.y, foot.z);
        positions.needsUpdate = true;
        data.line.geometry.computeBoundingSphere?.();
      }

      function writeRealFootFromSolvedChain(calfLength) {
        if (!shimRoot || !data.realFoot?.parent) return;
        const hip = data.hipPosition.clone();
        const knee = hip.clone().add(new THREE.Vector3(0, -data.thighLength, 0).applyQuaternion(data.thighQuaternion));
        const calfWorldQuaternion = data.thighQuaternion.clone().multiply(data.calfLocalQuaternion);
        const endpoint = knee.clone().add(new THREE.Vector3(0, -Math.abs(Number(calfLength) || 0), 0).applyQuaternion(calfWorldQuaternion));
        shimRoot.updateMatrixWorld?.(true);
        data.realFoot.parent.updateMatrixWorld?.(true);
        const endpointParent = data.realFoot.parent.worldToLocal(shimRoot.localToWorld(endpoint.clone()));
        data.realFoot.position.copy(endpointParent);
        data.realFoot.updateMatrixWorld?.(true);
        writeCanonicalLine(hip, knee, endpoint);
      }

      const thighQuaternionProxy = {
        clone: () => data.thighQuaternion.clone(),
        copy(value) { data.thighQuaternion.copy(value); return thighQuaternionProxy; },
      };
      const calfQuaternionProxy = {
        clone: () => data.calfLocalQuaternion.clone(),
        copy(value) { data.calfLocalQuaternion.copy(value); return calfQuaternionProxy; },
      };
      const footQuaternionProxy = {
        clone: () => data.realFoot.quaternion.clone(),
        copy(value) { data.realFoot.quaternion.copy(value); return footQuaternionProxy; },
      };

      data.hip = {
        position: data.hipPosition,
        getWorldPosition(out) {
          refreshHipAndThigh();
          shimRoot.updateMatrixWorld?.(true);
          return out.copy(data.hipPosition).applyMatrix4(shimRoot.matrixWorld);
        },
      };
      data.thigh = { quaternion: thighQuaternionProxy };
      data.calf = {
        position: { set(_x, y) { data.thighLength = Math.abs(Number(y) || 0); return this; } },
        quaternion: calfQuaternionProxy,
      };
      data.foot = {
        position: { set(_x, y) { writeRealFootFromSolvedChain(Math.abs(Number(y) || 0)); return this; } },
        quaternion: footQuaternionProxy,
        getWorldPosition(out) { return data.realFoot.getWorldPosition(out); },
      };
      refreshHipAndThigh();
      return data;
    }

    function buildShim(model, canonicalRoot, experimentalRoot, realFeet) {
      clearShim();
      activeModel = model;
      realFeetRoot = experimentalRoot;
      legDebugRoot = canonicalRoot;
      const GroupCtor = model?.constructor;
      const Vector3 = model?.position?.constructor;
      const Quaternion = model?.quaternion?.constructor;
      if (!GroupCtor || !Vector3 || !Quaternion) return false;
      const THREE = { Vector3, Quaternion };
      shimRoot = new GroupCtor();
      shimRoot.name = `${model.name || 'Avatar'}${GENERATED_RIG_SUFFIX}`;
      shimRoot.userData.editorGeneratedFeetDanceBridge = true;
      model.add(shimRoot);
      shimRoot.updateMatrixWorld?.(true);

      const leftLine = lineForSide(canonicalRoot, 'left');
      const rightLine = lineForSide(canonicalRoot, 'right');
      if (!leftLine || !rightLine) {
        clearShim();
        return false;
      }
      const left = makeSideProxy(THREE, realFeet.left, leftLine);
      const right = makeSideProxy(THREE, realFeet.right, rightLine);
      const proxies = {
        left_hip: left.hip, left_thigh: left.thigh, left_calf: left.calf, left_foot: left.foot,
        right_hip: right.hip, right_thigh: right.thigh, right_calf: right.calf, right_foot: right.foot,
      };
      const nativeGetObjectByName = shimRoot.getObjectByName.bind(shimRoot);
      shimRoot.getObjectByName = name => proxies[name] || nativeGetObjectByName(name);
      model.userData.editorGeneratedFeetDanceBridge = {
        source: experimentalRoot.name || 'ExperimentalFeet',
        canonicalBones: canonicalRoot.name || 'LegBonesDebug',
        leftFoot: realFeet.left.name || 'left generated foot',
        rightFoot: realFeet.right.name || 'right generated foot',
      };
      console.info(`[Dance feet] Reusing editor generated fallback feet: ${realFeet.left.name || 'left'} / ${realFeet.right.name || 'right'}.`);
      return true;
    }

    function refreshBridge() {
      const backdrop = window.HobunjiGameplayBackdrop;
      const scene = backdrop?.getScene?.() || null;
      const model = backdrop?.getAvatarModel?.() || null;
      const canonicalRoot = scene?.getObjectByName?.('LegBonesDebug') || null;
      const experimentalRoot = findExperimentalFeetRoot(canonicalRoot);
      const realFeet = findRealFeet(experimentalRoot);
      const stale = activeModel !== model || !shimRoot?.parent || realFeetRoot !== experimentalRoot || legDebugRoot !== canonicalRoot;
      if (model && canonicalRoot && experimentalRoot && realFeet && stale) {
        const danceWasEnabled = !!window.ProceduralDanceMode?.getDebug?.().enabled;
        if (buildShim(model, canonicalRoot, experimentalRoot, realFeet) && danceWasEnabled) {
          window.ProceduralDanceMode?.setEnabled?.(false);
          window.ProceduralDanceMode?.setEnabled?.(true);
        }
      } else if ((!model || !canonicalRoot || !experimentalRoot) && shimRoot) clearShim();
      requestAnimationFrame(refreshBridge);
    }

    window.HobunjiEditorDanceGeneratedFeet = {
      get active() { return !!shimRoot?.parent; },
      get source() { return realFeetRoot?.name || null; },
      get bones() { return legDebugRoot?.name || null; },
      get model() { return activeModel?.name || null; },
    };
    requestAnimationFrame(refreshBridge);
  }

  function refreshLatestChange() {
    const latest = document.querySelector('#proceduralDancePanel .danceLatest');
    if (latest) latest.textContent = 'Latest change: Dance now drives the editor generated fallback feet and native LegBonesDebug solve directly.';
  }

  function loadDanceCore() {
    if (window.ProceduralDanceMode?.installed || document.getElementById(CORE_SCRIPT_ID)) return;
    const script = document.createElement('script');
    script.id = CORE_SCRIPT_ID;
    script.async = false;
    script.src = SELF_SCRIPT_SRC ? new URL('procedural-dance-mode-core.js', SELF_SCRIPT_SRC).href : new URL('../../js/procedural-dance-mode-core.js', window.location.href).href;
    script.addEventListener('load', () => {
      refreshLatestChange();
      setTimeout(refreshLatestChange, 500);
    });
    script.addEventListener('error', () => {
      updateVisibleStatus(`Dance core failed to load: ${script.src}`, false);
      console.error(`[Dance mode] Failed to load ${script.src}`);
    });
    document.head.appendChild(script);
  }

  installCanonicalEditorLegBoneToggle();
  installEditorGeneratedFeetDanceBridge();
  loadDanceCore();
})();
