// Keeps farm livestock aligned with the authored two-actor harvest staging.
//
// FarmAnimals intentionally owns the actual harvest interaction and resource
// award. This bridge only coordinates the livestock participant while that
// existing interaction is active: it suppresses the ordinary nearby-player
// gaze/turn reaction, eases the animal to its stable logical tile anchor, and
// offsets the player by the same animal translation so the already-authored
// handler-to-animal spacing remains intact throughout the animation.
(() => {
  'use strict';

  if (window.LivestockHarvestStaging) return;

  const HARVEST_TRANSITION_S = 0.35; // Mirrors FarmAnimals' in/out transition so both participants reach their anchors together.
  const HARVEST_ACTIVE_DURATION_S = 2; // Mirrors FarmAnimals' authored active hold for phase-synchronous player correction.
  const PLAYER_ANIMATION_CHANNEL = 'livestock-harvest-animation'; // Owns the handler's whole-body render transform while a livestock harvest clip is active.
  const PLAYER_ANIMATION_PRIORITY = 1000; // Runs after ordinary stance/drunk/ragdoll channels so the synchronized harvest pose is visually authoritative.
  const PRE_RENDER_SCHEDULER_ID = 'livestock-harvest-animation-pose'; // Publishes the exact handler pose after game.js has resolved this frame's base player transform.
  const AUTHORED_MILKING_RUNTIME = Object.freeze({"duration":2,"animalAnchorTransform":{"position":{"x":-0.25,"y":-0.12,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"handler":{"baseTransform":{"position":{"x":0.007163636467419465,"y":0,"z":0.24946458385479475},"rotationDeg":{"x":84.00000000000091,"y":84.00000000000199,"z":-80},"scale":{"x":1,"y":1,"z":1}},"keyframes":[{"time":0,"transform":{"position":{"x":0.015525913528831925,"y":0.00009352128865883905,"z":0.20136724040735354},"rotationDeg":{"x":84.00000000000027,"y":83.99999999999811,"z":-87.99999999999999},"scale":{"x":1,"y":1,"z":1}},"neckRotationDeg":{"x":0,"y":0,"z":0}},{"time":0.5,"transform":{"position":{"x":0.007163636467419465,"y":0,"z":0.24946458385479475},"rotationDeg":{"x":84.00000000000072,"y":84.00000000000199,"z":-80},"scale":{"x":1,"y":1,"z":1}},"neckRotationDeg":{"x":0,"y":0,"z":0}},{"time":1,"transform":{"position":{"x":0.015525913528831925,"y":0.00009352128865883905,"z":0.20136724040735354},"rotationDeg":{"x":84.00000000000027,"y":83.99999999999821,"z":-87.99999999999999},"scale":{"x":1,"y":1,"z":1}},"neckRotationDeg":{"x":0,"y":0,"z":0}},{"time":1.5,"transform":{"position":{"x":0.007163636467419465,"y":0,"z":0.24946458385479475},"rotationDeg":{"x":84.00000000000091,"y":84.00000000000199,"z":-80},"scale":{"x":1,"y":1,"z":1}},"neckRotationDeg":{"x":0,"y":0,"z":0}},{"time":2,"transform":{"position":{"x":0.015525913528831925,"y":0.00009352128865883905,"z":0.20136724040735354},"rotationDeg":{"x":84.00000000000027,"y":83.99999999999811,"z":-87.99999999999999},"scale":{"x":1,"y":1,"z":1}},"neckRotationDeg":{"x":0,"y":0,"z":0}}]}}); // Exact two-second Milking preset exported from Multi-Avatar Animation Author.
  const AUTHORED_GREHLR_STINK_RUNTIME = Object.freeze({"duration":2,"handler":{"baseTransform":{"position":{"x":0.06390339615611051,"y":-0.612752361841974,"z":-0.8598544775819073},"rotationDeg":{"x":-21.205779322058742,"y":-44.06352228165268,"z":-4.5394555051756},"scale":{"x":1.0000000000000004,"y":1.0000000000000002,"z":1.0000000000000004}},"keyframes":[{"time":0,"transform":{"position":{"x":0.06390339615611051,"y":-0.612752361841974,"z":-0.8598544775819073},"rotationDeg":{"x":-21.205779322058742,"y":-44.06352228165268,"z":-4.5394555051756},"scale":{"x":1.0000000000000004,"y":1.0000000000000002,"z":1.0000000000000004}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":0.083333,"transform":{"position":{"x":0.05588720431309928,"y":-0.612577772046152,"z":-0.8506398549536351},"rotationDeg":{"x":-21.53911132205939,"y":-44.06352228165258,"z":-3.2061275051754934},"scale":{"x":0.9999999999999992,"y":0.9999999999999997,"z":0.9999999999999994}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":0.166667,"transform":{"position":{"x":0.04787091627540119,"y":-0.6123038348985748,"z":-0.8414569841832398},"rotationDeg":{"x":-21.872447322059987,"y":-44.06352228165253,"z":-1.8727835051754425},"scale":{"x":0.9999999999999993,"y":0.9999999999999999,"z":0.9999999999999993}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":0.25,"transform":{"position":{"x":0.03985472443238999,"y":-0.6119312228868783,"z":-0.8323072390047506},"rotationDeg":{"x":-22.205779322060664,"y":-44.06352228165243,"z":-0.5394555051753471},"scale":{"x":0.9999999999999999,"y":0.9999999999999998,"z":0.9999999999999999}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":0.333333,"transform":{"position":{"x":0.03183853258937873,"y":-0.6114606128645057,"z":-0.823191652827286},"rotationDeg":{"x":-22.53911132206128,"y":-44.06352228165234,"z":0.7938724948246954},"scale":{"x":0.9999999999999991,"y":0.9999999999999998,"z":0.9999999999999997}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":0.416667,"transform":{"position":{"x":0.023822244551680596,"y":-0.6108926904985476,"z":-0.8141112509990598},"rotationDeg":{"x":-22.87244732206202,"y":-44.063522281652325,"z":2.127216494824807},"scale":{"x":0.9999999999999999,"y":0.9999999999999998,"z":1}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":0.5,"transform":{"position":{"x":0.015806052708669305,"y":-0.6102281758825154,"z":-0.8050673756951228},"rotationDeg":{"x":-23.205779322062565,"y":-44.063522281652276,"z":3.4605444948248665},"scale":{"x":0.9999999999999997,"y":1,"z":0.9999999999999998}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":0.583333,"transform":{"position":{"x":0.023822244551680596,"y":-0.6108926904985476,"z":-0.8141112509990598},"rotationDeg":{"x":-22.87244732206197,"y":-44.063522281652325,"z":2.1272164948248022},"scale":{"x":1.0000000000000002,"y":0.9999999999999998,"z":1.0000000000000004}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":0.666667,"transform":{"position":{"x":0.03183853258937873,"y":-0.6114606128645057,"z":-0.823191652827286},"rotationDeg":{"x":-22.539111322061288,"y":-44.06352228165234,"z":0.793872494824693},"scale":{"x":0.9999999999999991,"y":0.9999999999999999,"z":0.9999999999999993}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":0.75,"transform":{"position":{"x":0.03985472443238999,"y":-0.6119312228868783,"z":-0.8323072390047506},"rotationDeg":{"x":-22.205779322060728,"y":-44.06352228165243,"z":-0.5394555051753481},"scale":{"x":0.9999999999999999,"y":0.9999999999999998,"z":0.9999999999999994}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":0.833333,"transform":{"position":{"x":0.04787091627540119,"y":-0.6123038348985748,"z":-0.8414569841832398},"rotationDeg":{"x":-21.872447322060104,"y":-44.06352228165251,"z":-1.8727835051754333},"scale":{"x":0.9999999999999993,"y":0.9999999999999999,"z":0.9999999999999994}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":0.916667,"transform":{"position":{"x":0.05588720431309928,"y":-0.612577772046152,"z":-0.8506398549536351},"rotationDeg":{"x":-21.539111322059505,"y":-44.063522281652595,"z":-3.2061275051755036},"scale":{"x":0.9999999999999991,"y":0.9999999999999998,"z":0.9999999999999992}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":1,"transform":{"position":{"x":0.06390339615611051,"y":-0.6127523618419736,"z":-0.8598544775819068},"rotationDeg":{"x":-21.205779322058852,"y":-44.06352228165273,"z":-4.539455505175607},"scale":{"x":0.9999999999999999,"y":1,"z":1.0000000000000002}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":1.083333,"transform":{"position":{"x":0.05588720431309932,"y":-0.612577772046152,"z":-0.8506398549536351},"rotationDeg":{"x":-21.53911132205951,"y":-44.063522281652595,"z":-3.2061275051755067},"scale":{"x":0.9999999999999991,"y":0.9999999999999998,"z":0.9999999999999992}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":1.1666666666666667,"transform":{"position":{"x":0.047870948340296454,"y":-0.6123038359943144,"z":-0.8414570209144295},"rotationDeg":{"x":-21.872445988776466,"y":-44.06352227050442,"z":-1.8727888385354416},"scale":{"x":0.9999999999999992,"y":0.9999999999999999,"z":0.9999999999999996}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":1.25,"transform":{"position":{"x":0.03985472443238999,"y":-0.6119312228868783,"z":-0.8323072390047506},"rotationDeg":{"x":-22.205779322060717,"y":-44.063522281652425,"z":-0.5394555051752884},"scale":{"x":0.9999999999999996,"y":0.9999999999999998,"z":0.9999999999999994}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":1.333333,"transform":{"position":{"x":0.031838532589378715,"y":-0.6114606128645059,"z":-0.8231916528272856},"rotationDeg":{"x":-22.539111322061327,"y":-44.06352228165238,"z":0.7938724948248419},"scale":{"x":0.9999999999999996,"y":0.9999999999999998,"z":0.9999999999999992}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":1.416667,"transform":{"position":{"x":0.023822244551680596,"y":-0.6108926904985476,"z":-0.8141112509990598},"rotationDeg":{"x":-22.87244732206201,"y":-44.0635222816523,"z":2.1272164948249563},"scale":{"x":1.0000000000000002,"y":0.9999999999999998,"z":1.0000000000000007}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":1.5,"transform":{"position":{"x":0.015806052708669305,"y":-0.6102281758825154,"z":-0.8050673756951228},"rotationDeg":{"x":-23.205779322062565,"y":-44.06352228165223,"z":3.4605444948250432},"scale":{"x":0.9999999999999996,"y":1,"z":0.9999999999999994}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":1.583333,"transform":{"position":{"x":0.023822244551680596,"y":-0.6108926904985476,"z":-0.8141112509990598},"rotationDeg":{"x":-22.87244732206201,"y":-44.063522281652304,"z":2.127216494824959},"scale":{"x":1.0000000000000002,"y":0.9999999999999998,"z":1.0000000000000009}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":1.666667,"transform":{"position":{"x":0.031838532589378715,"y":-0.6114606128645059,"z":-0.8231916528272856},"rotationDeg":{"x":-22.53911132206131,"y":-44.06352228165236,"z":0.7938724948248459},"scale":{"x":0.9999999999999993,"y":0.9999999999999997,"z":0.9999999999999994}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":1.75,"transform":{"position":{"x":0.03985472443238999,"y":-0.6119312228868783,"z":-0.8323072390047506},"rotationDeg":{"x":-22.20577932206065,"y":-44.06352228165243,"z":-0.5394555051752894},"scale":{"x":0.9999999999999994,"y":0.9999999999999999,"z":0.9999999999999994}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":1.833333,"transform":{"position":{"x":0.04787091627540113,"y":-0.6123038348985745,"z":-0.8414569841832407},"rotationDeg":{"x":-21.87244732205995,"y":-44.06352228165247,"z":-1.87278350517536},"scale":{"x":0.9999999999999998,"y":0.9999999999999999,"z":0.9999999999999997}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":1.916667,"transform":{"position":{"x":0.05588720431309932,"y":-0.612577772046152,"z":-0.8506398549536351},"rotationDeg":{"x":-21.539111322059405,"y":-44.06352228165258,"z":-3.2061275051754965},"scale":{"x":0.9999999999999992,"y":0.9999999999999997,"z":0.9999999999999996}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}},{"time":2,"transform":{"position":{"x":0.06390339615611051,"y":-0.612752361841974,"z":-0.8598544775819073},"rotationDeg":{"x":-21.205779322058742,"y":-44.06352228165268,"z":-4.5394555051756},"scale":{"x":1.0000000000000004,"y":1.0000000000000002,"z":1.0000000000000004}},"neckRotationDeg":{"x":-68,"y":-50,"z":-31}}]},"subject":{"baseTransform":{"position":{"x":-0.022124375957095502,"y":0.06484388560615706,"z":-0.2902001430271499},"rotationDeg":{"x":13.999379981017455,"y":4.219956425229038,"z":-1.4926251453232453},"scale":{"x":1,"y":1,"z":1}},"keyframes":[{"time":0,"transform":{"position":{"x":-0.022124375957095502,"y":0.06484388560615706,"z":-0.2902001430271499},"rotationDeg":{"x":13.999379981017455,"y":4.219956425229038,"z":-1.4926251453232453},"scale":{"x":1,"y":1,"z":1}}},{"time":0.5,"transform":{"position":{"x":-0.022124375957095502,"y":0.07484388560615707,"z":-0.2902001430271499},"rotationDeg":{"x":11.999379981017455,"y":4.219956425229038,"z":-1.4926251453232453},"scale":{"x":1,"y":1,"z":1}}},{"time":1,"transform":{"position":{"x":-0.022124375957095502,"y":0.06484388560615706,"z":-0.2902001430271499},"rotationDeg":{"x":13.999379981017455,"y":4.219956425229038,"z":-1.4926251453232453},"scale":{"x":1,"y":1,"z":1}}},{"time":1.5,"transform":{"position":{"x":-0.022124375957095502,"y":0.07484388560615707,"z":-0.2902001430271499},"rotationDeg":{"x":11.999379981017455,"y":4.219956425229038,"z":-1.4926251453232453},"scale":{"x":1,"y":1,"z":1}}},{"time":2,"transform":{"position":{"x":-0.022124375957095502,"y":0.06484388560615706,"z":-0.2902001430271499},"rotationDeg":{"x":13.999379981017455,"y":4.219956425229038,"z":-1.4926251453232453},"scale":{"x":1,"y":1,"z":1}}}]}}); // Exact V15.24 Grehlr stink-oil subject/handler tracks from the Animation Author.
  const VENOM_HANDLER_DELTA = Object.freeze({ position: { x: -0.25, y: 0.02, z: 0.18 }, rotationDeg: { x: 0, y: 90, z: 0 }, scale: { x: 1, y: 1, z: 1 } }); // Same left-multiplied handler delta used by applyVenomExtractionPreset in the authoring tool.
  const VENOM_SUBJECT_TRACK = Object.freeze({
    baseTransform: { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: -5.5, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    keyframes: [
      { time: 0, transform: { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: -5.5, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } },
      { time: 0.5, transform: { position: { x: 0, y: 0.01, z: 0 }, rotationDeg: { x: -7.5, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } },
      { time: 1, transform: { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: -5.5, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } },
      { time: 1.5, transform: { position: { x: 0, y: 0.01, z: 0 }, rotationDeg: { x: -7.5, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } },
      { time: 2, transform: { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: -5.5, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } },
    ],
  }); // Exact venom-subject bob/pitch loop authored by venomExtractionSubjectKeys().
  const harvestClipCache = new Map(); // Lazily stores species-specific runtime clips after any required Matrix4 conversion has been performed once.
  let animationSchedulerReady = false; // Reported by getDebug so mobile QA can tell whether the pre-render handler-pose publisher is installed.
  let farmDeps = null; // Captures FarmAnimals' injected world/player seam for staging and debug output.
  const patchedAnimals = new WeakSet(); // Prevents wrapping a livestock instance's update method more than once.
  const harvestStates = new WeakMap(); // Stores one temporary multi-avatar staging state per harvesting livestock instance.
  let activeHarvestAnimal = null; // Points at the currently staged animal for fast lookup and mobile-visible diagnostics.
  const debug = { starts: 0, completes: 0, last: null }; // Exposed through getDebug() so the behavior can be inspected without devtools.

  function finite(value, fallback = 0) {
    const number = Number(value); // Used to normalize runtime coordinates before interpolation.
    return Number.isFinite(number) ? number : fallback;
  }


  function identityTransform() {
    return { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
  }

  function transformWithPositionOffset(snapshot, offset) {
    const source = snapshot || identityTransform();
    return {
      ...source,
      position: {
        x: finite(source.position?.x) + finite(offset?.x),
        y: finite(source.position?.y) + finite(offset?.y),
        z: finite(source.position?.z) + finite(offset?.z),
      },
    };
  }

  function trackWithPositionOffset(track, offset) {
    return {
      baseTransform: transformWithPositionOffset(track?.baseTransform, offset),
      keyframes: (track?.keyframes || []).map(key => ({
        ...key,
        transform: transformWithPositionOffset(key.transform, offset),
      })),
    };
  }

  function transformMatrix(snapshot) {
    const THREE = window.THREE;
    if (!THREE) return null;
    const source = snapshot || identityTransform();
    const position = source.position || {};
    const rotation = source.rotationDeg || {};
    const scale = source.scale || {};
    return new THREE.Matrix4().compose(
      new THREE.Vector3(finite(position.x), finite(position.y), finite(position.z)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(
        finite(rotation.x) * Math.PI / 180,
        finite(rotation.y) * Math.PI / 180,
        finite(rotation.z) * Math.PI / 180,
        'XYZ',
      )),
      new THREE.Vector3(
        Number.isFinite(Number(scale.x)) ? Number(scale.x) : 1,
        Number.isFinite(Number(scale.y)) ? Number(scale.y) : 1,
        Number.isFinite(Number(scale.z)) ? Number(scale.z) : 1,
      ),
    );
  }

  function transformSnapshotFromMatrix(matrix) {
    const THREE = window.THREE;
    if (!THREE || !matrix) return identityTransform();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, quaternion, scale);
    const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
    return {
      position: { x: position.x, y: position.y, z: position.z },
      rotationDeg: {
        x: rotation.x * 180 / Math.PI,
        y: rotation.y * 180 / Math.PI,
        z: rotation.z * 180 / Math.PI,
      },
      scale: { x: scale.x, y: scale.y, z: scale.z },
    };
  }

  function transformWithLeftDelta(snapshot, delta) {
    const sourceMatrix = transformMatrix(snapshot);
    const deltaMatrix = transformMatrix(delta);
    return sourceMatrix && deltaMatrix
      ? transformSnapshotFromMatrix(deltaMatrix.multiply(sourceMatrix))
      : snapshot;
  }

  function transformTrackWithLeftDelta(track, delta) {
    return {
      baseTransform: transformWithLeftDelta(track?.baseTransform, delta),
      keyframes: (track?.keyframes || []).map(key => ({
        ...key,
        transform: transformWithLeftDelta(key.transform, delta),
      })),
    };
  }

  function harvestClipFor(kind) {
    const key = String(kind || '').toLowerCase();
    if (harvestClipCache.has(key)) return harvestClipCache.get(key);
    const anchorOffset = AUTHORED_MILKING_RUNTIME.animalAnchorTransform.position;
    let clip = null;
    if (key === 'gar-wolf') {
      clip = {
        key: 'milking',
        duration: AUTHORED_MILKING_RUNTIME.duration,
        handler: trackWithPositionOffset(AUTHORED_MILKING_RUNTIME.handler, anchorOffset),
        subject: { baseTransform: identityTransform(), keyframes: [] },
        subjectAnimated: false,
      };
    } else if (key === 'dabinggi-hound' && window.THREE) {
      const venomHandler = transformTrackWithLeftDelta(AUTHORED_MILKING_RUNTIME.handler, VENOM_HANDLER_DELTA);
      clip = {
        key: 'venom-extraction',
        duration: AUTHORED_MILKING_RUNTIME.duration,
        handler: trackWithPositionOffset(venomHandler, anchorOffset),
        subject: VENOM_SUBJECT_TRACK,
        subjectAnimated: true,
      };
    } else if (key === 'grehlr') {
      clip = {
        key: 'grehlr-stink-oil',
        duration: AUTHORED_GREHLR_STINK_RUNTIME.duration,
        handler: AUTHORED_GREHLR_STINK_RUNTIME.handler,
        subject: AUTHORED_GREHLR_STINK_RUNTIME.subject,
        subjectAnimated: true,
      };
    }
    harvestClipCache.set(key, clip);
    return clip;
  }

  function quaternionForTransform(transform) {
    const THREE = window.THREE;
    if (!THREE) return null;
    const rotation = transform?.rotationDeg || {};
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
      finite(rotation.x) * Math.PI / 180,
      finite(rotation.y) * Math.PI / 180,
      finite(rotation.z) * Math.PI / 180,
      'XYZ',
    ));
  }

  function sampleTrack(track, time) {
    const THREE = window.THREE;
    if (!THREE || !track) return null;
    const keys = [...(track.keyframes || [])].sort((a, b) => finite(a.time) - finite(b.time));
    if (!keys.length) {
      const transform = track.baseTransform || identityTransform();
      return { position: { ...transform.position }, quaternion: quaternionForTransform(transform) };
    }
    const t = Math.max(finite(keys[0].time), Math.min(finite(keys[keys.length - 1].time), finite(time)));
    let left = keys[0], right = keys[keys.length - 1];
    for (let index = 0; index < keys.length - 1; index++) {
      if (t >= finite(keys[index].time) && t <= finite(keys[index + 1].time)) {
        left = keys[index];
        right = keys[index + 1];
        break;
      }
    }
    const span = Math.max(0.000001, finite(right.time) - finite(left.time));
    const alpha = left === right ? 0 : (t - finite(left.time)) / span;
    const lp = left.transform?.position || {};
    const rp = right.transform?.position || lp;
    const leftQuaternion = quaternionForTransform(left.transform);
    const rightQuaternion = quaternionForTransform(right.transform);
    return {
      position: {
        x: finite(lp.x) + (finite(rp.x) - finite(lp.x)) * alpha,
        y: finite(lp.y) + (finite(rp.y) - finite(lp.y)) * alpha,
        z: finite(lp.z) + (finite(rp.z) - finite(lp.z)) * alpha,
      },
      quaternion: new THREE.Quaternion().slerpQuaternions(leftQuaternion, rightQuaternion, alpha),
    };
  }

  function smoothStep01(value) {
    const t = Math.max(0, Math.min(1, finite(value)));
    return t * t * (3 - 2 * t);
  }

  function harvestPoseWeight(state) {
    if (!state || state.phase === 'done') return 0;
    if (state.phase === 'in') return smoothStep01(state.t);
    if (state.phase === 'out') return 1 - smoothStep01(state.t);
    return 1;
  }

  function harvestClipTime(state) {
    if (!state?.clip) return 0;
    if (state.phase === 'active') return Math.max(0, Math.min(state.clip.duration, finite(state.t)));
    if (state.phase === 'out' || state.phase === 'done') return state.clip.duration;
    return 0;
  }

  function applyAnimalHarvestPose(state) {
    const animal = state?.animal;
    const group = animal?.avatarRef?.group;
    const THREE = window.THREE;
    if (!animal || !group) return false;
    if (!state.clip || !THREE) {
      group.position.set(state.renderX, state.renderY, state.renderZ);
      group.rotation.y = state.rotation;
      return false;
    }
    const weight = harvestPoseWeight(state);
    const sample = sampleTrack(state.clip.subject, harvestClipTime(state));
    if (!sample?.quaternion) return false;
    const anchorYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.rotation);
    const localOffset = new THREE.Vector3(
      finite(sample.position?.x),
      finite(sample.position?.y),
      finite(sample.position?.z),
    ).multiplyScalar(weight);
    const worldOffset = localOffset.applyQuaternion(anchorYaw);
    const weightedSubjectRotation = new THREE.Quaternion().slerpQuaternions(
      new THREE.Quaternion(),
      sample.quaternion,
      weight,
    );
    group.position.set(
      state.renderX + worldOffset.x,
      state.renderY + worldOffset.y,
      state.renderZ + worldOffset.z,
    );
    group.quaternion.copy(anchorYaw).multiply(weightedSubjectRotation);
    state.animalAnimationApplied = !!state.clip.subjectAnimated && weight > 0.0001;
    state.lastClipTime = harvestClipTime(state);
    state.lastPoseWeight = weight;
    return true;
  }

  function clearPlayerHarvestPose() {
    window.PlayerBodyTransformComposer?.clearChannel?.(PLAYER_ANIMATION_CHANNEL);
  }

  function publishPlayerHarvestPose() {
    const state = activeHarvestAnimal ? harvestStates.get(activeHarvestAnimal) : null;
    const composer = window.PlayerBodyTransformComposer;
    const THREE = window.THREE;
    const playerRoot = composer?.getPlayerMesh?.();
    if (!state?.clip || !THREE || !playerRoot || !activeHarvestAnimal?._harvestFrozen) {
      clearPlayerHarvestPose();
      if (state) state.playerAnimationApplied = false;
      return;
    }
    const weight = harvestPoseWeight(state);
    if (weight <= 0.0001) {
      clearPlayerHarvestPose();
      state.playerAnimationApplied = false;
      return;
    }
    const sample = sampleTrack(state.clip.handler, harvestClipTime(state));
    if (!sample?.quaternion) return;
    playerRoot.updateWorldMatrix?.(true, false);
    const baseWorldQuaternion = playerRoot.getWorldQuaternion(new THREE.Quaternion()).normalize();
    const animalYawQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.rotation);
    const desiredWorldQuaternion = animalYawQuaternion.clone().multiply(sample.quaternion).normalize();
    const localDeltaQuaternion = baseWorldQuaternion.clone().invert().multiply(desiredWorldQuaternion).normalize();
    const weightedDeltaQuaternion = new THREE.Quaternion().slerpQuaternions(
      new THREE.Quaternion(),
      localDeltaQuaternion,
      weight,
    );
    const basePosition = state.clip.handler.baseTransform?.position || {};
    const authoredLocalTranslation = new THREE.Vector3(
      finite(sample.position?.x) - finite(basePosition.x),
      finite(sample.position?.y),
      finite(sample.position?.z) - finite(basePosition.z),
    );
    const desiredWorldTranslation = authoredLocalTranslation.applyQuaternion(animalYawQuaternion);
    const composerLocalTranslation = desiredWorldTranslation
      .applyQuaternion(baseWorldQuaternion.clone().invert())
      .multiplyScalar(weight);
    composer.setChannel(PLAYER_ANIMATION_CHANNEL, {
      priority: PLAYER_ANIMATION_PRIORITY,
      mode: 'override',
      translationMode: 'override',
      quaternion: weightedDeltaQuaternion,
      translation: {
        x: composerLocalTranslation.x,
        y: composerLocalTranslation.y,
        z: composerLocalTranslation.z,
      },
    });
    state.playerAnimationApplied = true;
    state.lastClipTime = harvestClipTime(state);
    state.lastPoseWeight = weight;
  }

  function installAnimationScheduler() {
    const scheduler = window.RuntimeFrameScheduler;
    if (!scheduler?.register) return false;
    scheduler.register(PRE_RENDER_SCHEDULER_ID, publishPlayerHarvestPose, {
      phase: 'pre-render',
      owner: 'LivestockHarvestStaging',
      description: 'Publishes the authored multi-avatar livestock harvest handler pose after gameplay resolves the player base transform.',
    });
    animationSchedulerReady = true;
    return true;
  }

  function findHarvestAnimal() {
    if (activeHarvestAnimal?._harvestFrozen) return activeHarvestAnimal;
    for (const animal of farmDeps?.animalObjects || []) {
      if (animal?._harvestFrozen) return animal;
    }
    return null;
  }

  function ensureHarvestState(animal) {
    if (!animal) return null;
    const existing = harvestStates.get(animal); // Reuses the same anchor snapshot for every frame of this harvest.
    if (existing) return existing;

    const targetCol = finite(animal.targetCol, finite(animal.col)); // Resolves the logical farm tile the animal was already walking toward.
    const targetRow = finite(animal.targetRow, finite(animal.row)); // Resolves the logical farm row the animal was already walking toward.
    const grid = farmDeps?.getGrid?.(); // Used to align the harvest anchor with the destination tile's real surface height.
    const tile = grid?.[targetRow]?.[targetCol]; // Supplies the terrain type beneath the staged livestock anchor.
    const groundLift = finite(animal.groundLift, finite(animal.halfHeight)); // Keeps the same species/genotype floor offset as ordinary movement.
    const startRotation = finite(animal.groupRot, finite(animal.avatarRef?.group?.rotation?.y)); // Locks the authored harvest frame to the animal's pre-interaction facing.
    const state = {
      animal,
      phase: 'in',
      t: 0,
      startX: finite(animal.wx),
      startY: finite(animal.wy),
      startZ: finite(animal.wz),
      targetX: targetCol + 0.5,
      targetY: tile ? finite(farmDeps?.tileSurfaceY?.(tile.type), finite(animal.wy) - groundLift) + groundLift : finite(animal.wy),
      targetZ: targetRow + 0.5,
      rotation: startRotation,
      renderX: finite(animal.wx),
      renderY: finite(animal.wy),
      renderZ: finite(animal.wz),
      deltaPxX: 0,
      deltaPxY: 0,
      appliedPlayerCorrectionPxX: 0,
      appliedPlayerCorrectionPxY: 0,
      canonicalResetPlayerPositionThisFrame: false,
      clip: harvestClipFor(animal.animalKey), // Selects the exact Animation Author track for this livestock species.
      playerAnimationApplied: false,
      animalAnimationApplied: false,
      lastClipTime: 0,
      lastPoseWeight: 0,
    }; // Drives both the livestock transform and the equal player-space correction during this harvest.

    harvestStates.set(animal, state);
    activeHarvestAnimal = animal;
    debug.starts++;
    debug.last = {
      livestockId: animal.livestockId || animal.id || null,
      animalKey: animal.animalKey || null,
      startedAt: Date.now(),
      start: { x: state.startX, y: state.startY, z: state.startZ },
      target: { x: state.targetX, y: state.targetY, z: state.targetZ },
    };
    window.__farmLog?.(`[harvest] staging ${animal.animalKey || animal.id || 'livestock'} to ${state.targetX.toFixed(3)}, ${state.targetZ.toFixed(3)} with approach reaction suppressed`, 'wildlife');
    return state;
  }

  function updateRenderPosition(state, progress) {
    const e = Math.max(0, Math.min(1, finite(progress))); // Used as the synchronized livestock in-transition lerp factor.
    state.renderX = state.startX + (state.targetX - state.startX) * e;
    state.renderY = state.startY + (state.targetY - state.startY) * e;
    state.renderZ = state.startZ + (state.targetZ - state.startZ) * e;
    const tileSize = finite(farmDeps?.TILE, 1) || 1; // Converts livestock tile-space movement into the player's pixel-space staging coordinates.
    state.deltaPxX = (state.renderX - state.startX) * tileSize;
    state.deltaPxY = (state.renderZ - state.startZ) * tileSize;
  }

  function advanceHarvestState(state, dt) {
    if (!state) return;
    const frameDt = Math.max(0, finite(dt)); // Mirrors the same dt consumed by FarmAnimals.updateHarvestInteraction.
    const phaseBeforeAdvance = state.phase; // Identifies whether the canonical harvest update rewrites player x/y on this frame.
    state.canonicalResetPlayerPositionThisFrame = phaseBeforeAdvance === 'in' || phaseBeforeAdvance === 'out';
    if (state.phase === 'in') {
      state.t = Math.min(1, state.t + frameDt / HARVEST_TRANSITION_S);
      updateRenderPosition(state, state.t);
      if (state.t >= 1) { state.phase = 'active'; state.t = 0; }
      return;
    }
    updateRenderPosition(state, 1);
    if (state.phase === 'active') {
      state.t += frameDt;
      if (state.t >= HARVEST_ACTIVE_DURATION_S) { state.phase = 'out'; state.t = 0; }
      return;
    }
    if (state.phase === 'out') {
      state.t = Math.min(1, state.t + frameDt / HARVEST_TRANSITION_S);
      if (state.t >= 1) state.phase = 'done';
    }
  }

  function playerCorrectionWeight(state) {
    if (!state || state.phase === 'done') return 0;
    return state.phase === 'out' ? Math.max(0, 1 - state.t) : 1;
  }

  function applyPlayerCorrection(state) {
    const player = farmDeps?.player; // Receives the livestock translation so the authored handler offset remains unchanged while both actors lerp.
    if (!player || !state) return;
    const weight = playerCorrectionWeight(state); // Fades the shared translation back out only while the player returns to their pre-harvest position.
    const desiredX = state.deltaPxX * weight; // Tracks the correction that should exist on the player's X coordinate after this canonical harvest frame.
    const desiredY = state.deltaPxY * weight; // Tracks the correction that should exist on the player's Y/Z-plane coordinate after this canonical harvest frame.
    const addX = state.canonicalResetPlayerPositionThisFrame ? desiredX : desiredX - state.appliedPlayerCorrectionPxX; // Reapplies fully after canonical in/out lerps, but only by delta during the active hold.
    const addY = state.canonicalResetPlayerPositionThisFrame ? desiredY : desiredY - state.appliedPlayerCorrectionPxY; // Prevents the active phase from accumulating the same translation every frame.
    player.x = finite(player.x) + addX;
    player.y = finite(player.y) + addY;
    state.appliedPlayerCorrectionPxX = desiredX;
    state.appliedPlayerCorrectionPxY = desiredY;
  }

  function finishHarvestState(animal) {
    const state = animal ? harvestStates.get(animal) : null; // Supplies the completed target for the debug snapshot before cleanup.
    if (!state) return;
    debug.completes++;
    debug.last = {
      ...(debug.last || {}),
      completedAt: Date.now(),
      final: { x: state.renderX, y: state.renderY, z: state.renderZ },
    };
    harvestStates.delete(animal);
    if (activeHarvestAnimal === animal) activeHarvestAnimal = null;
    clearPlayerHarvestPose();
  }

  function patchAnimal(animal) {
    if (!animal || patchedAnimals.has(animal) || typeof animal.update !== 'function') return;
    const originalUpdate = animal.update; // Preserves blink/breath/texture maintenance while harvest staging overrides only pose-facing concerns.
    animal.update = function harvestAwareLivestockUpdate(dt) {
      if (!this._harvestFrozen) {
        if (harvestStates.has(this)) finishHarvestState(this);
        return originalUpdate.call(this, dt);
      }

      const state = ensureHarvestState(this); // Owns the stable multi-avatar anchor and exact authored two-actor clip for the full harvest interaction.
      if (!state) return originalUpdate.call(this, dt);
      originalUpdate.call(this, dt); // Keeps grounding, breathing, blinking, and texture maintenance alive; FarmAnimals itself now gates ordinary facing while _harvestFrozen.

      this.wx = state.renderX;
      this.wy = state.renderY;
      this.wz = state.renderZ;
      this.groupRot = state.rotation; // Logical facing stays stable even when the rendered subject track adds temporary pitch/yaw/roll.
      applyAnimalHarvestPose(state);
    };
    patchedAnimals.add(animal);
  }

  function patchAnimalCollection(deps) {
    const animals = deps?.animalObjects; // Receives wrappers for both livestock already present and every later spawn.
    if (!animals || animals.__hobunjiHarvestStagingPatched) return;
    for (const animal of animals) patchAnimal(animal);
    const originalAdd = animals.add; // Ensures newly spawned/reloaded livestock gets the same harvest-aware update wrapper.
    if (typeof originalAdd === 'function') {
      animals.add = function harvestAwareAnimalAdd(animal) {
        patchAnimal(animal);
        return originalAdd.call(this, animal);
      };
    }
    Object.defineProperty(animals, '__hobunjiHarvestStagingPatched', { value: true, configurable: true });
  }

  function patchFarmAnimals(api) {
    if (!api?.init || api.__hobunjiHarvestStagingPatched) return;
    const originalInit = api.init.bind(api); // Captures FarmAnimals' injected dependencies before forwarding to its own initializer.
    api.init = function harvestStagingFarmAnimalsInit(injectedDeps) {
      farmDeps = injectedDeps;
      patchAnimalCollection(injectedDeps);
      return originalInit(injectedDeps);
    };

    if (typeof api.updateHarvestInteraction === 'function') {
      const originalUpdateHarvestInteraction = api.updateHarvestInteraction.bind(api); // Retains FarmAnimals as the authority for phases, resource award, camera, and player facing.
      api.updateHarvestInteraction = function stagedHarvestInteractionUpdate(dt) {
        const animal = findHarvestAnimal(); // Identifies the single livestock participant frozen by FarmAnimals for this interaction.
        const state = animal ? ensureHarvestState(animal) : null; // Supplies the synchronized animal transform and player correction for this frame.
        if (state) advanceHarvestState(state, dt);
        const result = originalUpdateHarvestInteraction(dt); // Runs the canonical interaction first; correction below only translates its authored arrangement.
        if (state) {
          applyPlayerCorrection(state);
          if (!api.isHarvesting?.() || !animal?._harvestFrozen) finishHarvestState(animal);
        }
        return result;
      };
    }

    api.__hobunjiHarvestStagingPatched = true;
  }

  function chainFutureGlobal(name, afterSet) {
    if (window[name]) { afterSet(window[name]); return; }
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Preserves any earlier late-binding bridge installed for the same global.
    if (descriptor && typeof descriptor.set === 'function') {
      const previousSet = descriptor.set; // Chains our patch after the existing global-assignment observer.
      Object.defineProperty(window, name, {
        configurable: descriptor.configurable !== false,
        enumerable: descriptor.enumerable !== false,
        get: descriptor.get,
        set(value) {
          previousSet.call(window, value);
          afterSet(value);
        },
      });
      return;
    }
    if (descriptor && !descriptor.configurable) return;
    let value; // Holds FarmAnimals until its normal script assigns the real API object.
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(next) {
        value = next;
        afterSet(next);
      },
    });
  }

  function getDebug() {
    const animal = activeHarvestAnimal; // Selects the active participant for an inspectable no-devtools snapshot.
    const state = animal ? harvestStates.get(animal) : null; // Supplies current phase/anchor data without exposing mutable internal state.
    return {
      starts: debug.starts,
      completes: debug.completes,
      last: debug.last ? { ...debug.last } : null,
      animationSchedulerReady,
      active: state ? {
        livestockId: animal.livestockId || animal.id || null,
        animalKey: animal.animalKey || null,
        clipKey: state.clip?.key || null,
        phase: state.phase,
        t: state.t,
        clipTime: state.lastClipTime,
        poseWeight: state.lastPoseWeight,
        playerAnimationApplied: !!state.playerAnimationApplied,
        animalAnimationApplied: !!state.animalAnimationApplied,
        start: { x: state.startX, y: state.startY, z: state.startZ },
        target: { x: state.targetX, y: state.targetY, z: state.targetZ },
        current: { x: state.renderX, y: state.renderY, z: state.renderZ },
        playerCorrectionPx: { x: state.deltaPxX, y: state.deltaPxY },
        playerApproachSuppressed: true,
      } : null,
    };
  }

  animationSchedulerReady = installAnimationScheduler();
  chainFutureGlobal('FarmAnimals', patchFarmAnimals);
  window.LivestockHarvestStaging = Object.freeze({ getDebug, harvestClipFor });
})();
