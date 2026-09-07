// Generic authored-furniture piece animation runtime.
// Keeps rigid piece-to-piece motion separate from processing warps/deformation.
(() => {
  'use strict';
  if (!window.THREE) return;

  const DEG = Math.PI / 180;
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpMid = new THREE.Vector3(), tmpDir = new THREE.Vector3();
  const tmpPos = new THREE.Vector3(), tmpQuat = new THREE.Quaternion(), tmpScale = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4(), tmpAnchorMat = new THREE.Matrix4(), tmpGroupInv = new THREE.Matrix4();
  const sharedRopeTextures = new Map(); // Source URL -> shared loaded rope texture; instances clone it only for repeat values.
  const FALLBACK_WIND = Object.freeze({
    spatialPhaseX:1.7, spatialPhaseZ:2.3, calmStrength:0.03, maximumStrengthScale:4,
    primaryFrequency:1.6, secondaryFrequency:1.1, secondaryAmplitudeRatio:0.45, secondaryPhaseMultiplier:1.3,
    ropeAmplitudeDegAtCalm:4.6, ropeSwingMaxDeg:18, bottleAmplitudeScale:0.32, bottlePhaseLag:0.22, bottleSwingMaxDeg:8,
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const vec = (source, fallback={x:0,y:0,z:0}) => new THREE.Vector3(
    Number.isFinite(Number(source?.x)) ? Number(source.x) : fallback.x,
    Number.isFinite(Number(source?.y)) ? Number(source.y) : fallback.y,
    Number.isFinite(Number(source?.z)) ? Number(source.z) : fallback.z,
  );
  const axisOf = source => {
    const axis = vec(source, {x:0,y:0,z:1});
    if (axis.lengthSq() < 1e-8) axis.set(0,0,1);
    return axis.normalize();
  };
  const windConfig = () => window.HOBUNJI_ROOT_TOTEM_CONFIG?.bottle?.wind || FALLBACK_WIND;

  function normalizeConnector(record={}) {
    return {
      anchorOffset:{x:Number(record.anchorOffset?.x)||0,y:Number(record.anchorOffset?.y)||0,z:Number(record.anchorOffset?.z)||0},
      drivenOffset:{x:Number(record.drivenOffset?.x)||0,y:Number(record.drivenOffset?.y)||0,z:Number(record.drivenOffset?.z)||0},
      texture:record.texture || 'textures/wavy_surface.png',
      color:record.color || '#6b4728',
      radius:Math.max(.002, Number(record.radius)||.012),
      sides:Math.max(3, Math.min(12, Math.round(Number(record.sides)||5))),
      visible:record.visible !== false,
    };
  }

  function normalizeAnimation(record={}) {
    return {
      id:record.id || `pieceanim_${Math.random().toString(36).slice(2,9)}`,
      name:record.name || 'Piece Animation',
      type:['windSwing','hinge','spin','bob'].includes(record.type) ? record.type : 'windSwing',
      enabled:record.enabled !== false,
      drivenPartId:record.drivenPartId || null,
      anchorPartId:record.anchorPartId || null,
      pivot:{x:Number(record.pivot?.x)||0,y:Number(record.pivot?.y)||0,z:Number(record.pivot?.z)||0},
      axis:{x:Number(record.axis?.x)||0,y:Number(record.axis?.y)||0,z:Number(record.axis?.z ?? 1)||0},
      amplitudeDeg:Number.isFinite(Number(record.amplitudeDeg)) ? Number(record.amplitudeDeg) : 4.6,
      maxDeg:Number.isFinite(Number(record.maxDeg)) ? Math.max(0,Number(record.maxDeg)) : 18,
      distance:Number.isFinite(Number(record.distance)) ? Number(record.distance) : .08,
      speed:Number.isFinite(Number(record.speed)) ? Number(record.speed) : 1.6,
      phaseDeg:Number(record.phaseDeg)||0,
      windResponse:Number.isFinite(Number(record.windResponse)) ? Number(record.windResponse) : 1,
      connectors:Array.isArray(record.connectors) ? record.connectors.map(normalizeConnector) : [],
    };
  }

  function assetUrl(path, assetBase='assets/') {
    if (!path) return null;
    if (/^(?:data:|blob:|https?:|\/)/i.test(path)) return path;
    const trimmed = String(path).replace(/^assets\//,'');
    return assetBase + trimmed;
  }

  function makeRope(connector, assetBase) {
    const geometry = new THREE.CylinderGeometry(connector.radius, connector.radius*.94, 1, connector.sides, 1, true);
    const sourceUrl=assetUrl(connector.texture, assetBase);
    let shared=sharedRopeTextures.get(sourceUrl);
    if(!shared){shared=new THREE.TextureLoader().load(sourceUrl);shared.wrapS=shared.wrapT=THREE.RepeatWrapping;if('colorSpace' in shared&&THREE.SRGBColorSpace)shared.colorSpace=THREE.SRGBColorSpace;sharedRopeTextures.set(sourceUrl,shared);}
    const texture=shared.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 3);
    texture.needsUpdate=true;
    const material = new THREE.MeshLambertMaterial({map:texture,color:connector.color,side:THREE.FrontSide});
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'furniture_piece_animation_rope';
    mesh.userData.furniturePieceAnimationRope = true;
    mesh.userData.noOutline = true;
    mesh.raycast = () => {};
    return mesh;
  }

  function updateRope(controller, ropeRecord) {
    const {group, anchor, driven} = controller;
    const rope = ropeRecord.mesh;
    if (!rope || !ropeRecord.connector.visible) { if (rope) rope.visible=false; return; }
    rope.visible = true;
    anchor.updateWorldMatrix(true,false);
    driven.updateWorldMatrix(true,false);
    group.updateWorldMatrix(true,false);
    tmpA.copy(vec(ropeRecord.connector.anchorOffset));
    tmpB.copy(vec(ropeRecord.connector.drivenOffset));
    anchor.localToWorld(tmpA);
    driven.localToWorld(tmpB);
    group.worldToLocal(tmpA);
    group.worldToLocal(tmpB);
    tmpMid.copy(tmpA).add(tmpB).multiplyScalar(.5);
    tmpDir.copy(tmpB).sub(tmpA);
    const length = Math.max(.001, tmpDir.length());
    tmpDir.multiplyScalar(1/length);
    rope.position.copy(tmpMid);
    rope.quaternion.setFromUnitVectors(Y_AXIS, tmpDir);
    rope.scale.set(1,length,1);
    if (rope.material?.map) {
      const repeat = Math.max(1,length/.09);
      if (Math.abs(rope.material.map.repeat.y-repeat)>.05) { rope.material.map.repeat.y=repeat; rope.material.map.needsUpdate=true; }
    }
    rope.updateMatrixWorld(true);
  }

  function basePivotFrame(controller) {
    const {group, anchor, pivotLocal, pivot} = controller;
    group.updateWorldMatrix(true,false);
    anchor.updateWorldMatrix(true,false);
    tmpGroupInv.copy(group.matrixWorld).invert();
    tmpAnchorMat.copy(anchor.matrixWorld);
    tmpMat.makeTranslation(pivotLocal.x,pivotLocal.y,pivotLocal.z);
    tmpAnchorMat.multiply(tmpMat);
    tmpAnchorMat.premultiply(tmpGroupInv);
    tmpAnchorMat.decompose(tmpPos,tmpQuat,tmpScale);
    pivot.position.copy(tmpPos);
    pivot.quaternion.copy(tmpQuat);
    pivot.scale.set(1,1,1);
  }

  function windAngles(controller, nowSeconds) {
    const record = controller.record, wind = windConfig();
    const helper = window.DeadzoneBillboard;
    const snapshot = helper?.liveVegetationWindSnapshot?.();
    const amplitude = Math.max(0,record.amplitudeDeg)*DEG*record.windResponse;
    const limit = Math.max(0,record.maxDeg)*DEG;
    let x,z;
    if (snapshot && helper?.sampleVegetationSway) {
      controller.pivot.getWorldPosition(tmpPos);
      const phase = tmpPos.x*Number(wind.spatialPhaseX)+tmpPos.z*Number(wind.spatialPhaseZ)+record.phaseDeg*DEG;
      const sway = helper.sampleVegetationSway(snapshot,phase,amplitude,wind);
      x = clamp(sway.x,-limit,limit);
      z = clamp(sway.z,-limit,limit);
    } else {
      const phase = record.phaseDeg*DEG;
      z = clamp(amplitude*Math.sin(nowSeconds*Number(wind.primaryFrequency)+phase),-limit,limit);
      x = clamp(amplitude*Number(wind.secondaryAmplitudeRatio)*Math.cos(nowSeconds*Number(wind.secondaryFrequency)+phase*Number(wind.secondaryPhaseMultiplier)),-limit,limit);
    }
    return {x,z};
  }

  function updateController(controller, nowSeconds=performance.now()/1000) {
    const r = controller.record;
    basePivotFrame(controller);
    if (r.enabled) {
      if (r.type === 'windSwing') {
        const swing = windAngles(controller,nowSeconds);
        controller.pivot.rotateX(swing.x);
        controller.pivot.rotateZ(swing.z);
      } else if (r.type === 'hinge') {
        const angle = Math.sin(nowSeconds*r.speed+r.phaseDeg*DEG)*r.amplitudeDeg*DEG;
        controller.pivot.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(controller.axis,angle));
      } else if (r.type === 'spin') {
        const angle = (nowSeconds*r.speed*DEG*60)+(r.phaseDeg*DEG);
        controller.pivot.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(controller.axis,angle));
      } else if (r.type === 'bob') {
        const offset = Math.sin(nowSeconds*r.speed+r.phaseDeg*DEG)*r.distance;
        controller.pivot.position.addScaledVector(controller.axis,offset);
      }
    }
    controller.pivot.updateMatrixWorld(true);
    controller.driven.updateMatrixWorld(true);
    for (const ropeRecord of controller.ropes) updateRope(controller,ropeRecord);
  }

  function removeControllers(group) {
    const controllers = group?.userData?.pieceAnimationControllers || [];
    for (const controller of controllers) {
      const {driven,pivot,group:owner} = controller;
      if (driven && owner) {
        owner.attach(driven);
        const authored=driven.userData?.authoredMatrix;
        if(authored?.decompose){authored.decompose(driven.position,driven.quaternion,driven.scale);driven.updateMatrixWorld(true);}
      }
      for (const ropeRecord of controller.ropes || []) {
        const mesh = ropeRecord.mesh;
        mesh?.parent?.remove(mesh);
        mesh?.geometry?.dispose?.();
        mesh?.material?.map?.dispose?.();
        mesh?.material?.dispose?.();
      }
      pivot?.parent?.remove(pivot);
      if (driven && controller.previousBefore !== undefined) driven.onBeforeRender = controller.previousBefore;
    }
    if (group?.userData) group.userData.pieceAnimationControllers=[];
  }

  function install(group, data, options={}) {
    if (!group) return [];
    removeControllers(group);
    const records = (data?.pieceAnimations || []).map(normalizeAnimation).filter(record=>record.enabled!==false || options.includeDisabled);
    if (!records.length) return [];
    const meshById = options.meshById || group.userData?.meshById || new Map();
    const controllers=[];
    const drivenIds=new Set();
    group.updateMatrixWorld(true);
    for (const record of records) {
      if (!record.drivenPartId || drivenIds.has(record.drivenPartId)) continue;
      const driven=meshById.get(record.drivenPartId), anchor=meshById.get(record.anchorPartId)||group;
      if (!driven || !anchor || driven===anchor) continue;
      drivenIds.add(record.drivenPartId);
      const pivot=new THREE.Group();
      pivot.name=`piece_animation_${record.id}_pivot`;
      group.add(pivot);
      const controller={group,record,driven,anchor,pivot,pivotLocal:vec(record.pivot),axis:axisOf(record.axis),ropes:[],previousBefore:driven.onBeforeRender};
      basePivotFrame(controller);
      pivot.updateMatrixWorld(true);
      pivot.attach(driven);
      for (const connector of record.connectors) {
        const rope=makeRope(connector,options.assetBase||'assets/');
        group.add(rope);
        controller.ropes.push({connector,mesh:rope});
      }
      driven.onBeforeRender=function furniturePieceAnimationBeforeRender(...args){
        controller.previousBefore?.apply(this,args);
        updateController(controller,performance.now()/1000);
      };
      updateController(controller,performance.now()/1000);
      controllers.push(controller);
    }
    group.userData.pieceAnimationControllers=controllers;
    group.userData.pieceAnimations=records;
    return controllers;
  }

  const api={normalizeAnimation,install,removeControllers,updateController};
  window.FurniturePieceAnimationRuntime=api;

  if (window.AuthoredFurniture?.buildGroup && !window.AuthoredFurniture.__pieceAnimationWrapped) {
    const originalBuildGroup=window.AuthoredFurniture.buildGroup;
    window.AuthoredFurniture.buildGroup=function buildGroupWithPieceAnimations(data,baseColor){
      const group=originalBuildGroup.call(this,data,baseColor);
      install(group,data,{assetBase:'assets/'});
      return group;
    };
    window.AuthoredFurniture.__pieceAnimationWrapped=true;
  }
})();
