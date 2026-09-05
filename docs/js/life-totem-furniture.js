// Life Totem runtime composer. Runtime tuning is owned by
// docs/config/root-totem-config.js; this file only composes the procedural
// plant with the authored furniture layer.
(() => {
  'use strict';

  function config() {
    const value=window.HOBUNJI_ROOT_TOTEM_CONFIG;
    if(!value)throw new Error('LifeTotemFurniture requires config/root-totem-config.js.');
    return value;
  }
  const CFG=config(), FURN=CFG.furniture;
  const KEY=CFG.basin.authoredFurnitureKey, ITEM_KEY=FURN.itemKey;
  const DEF=Object.freeze({
    itemKey:ITEM_KEY,icon:FURN.icon,name:FURN.name,price:FURN.price,
    fw:FURN.footprint.w,fd:FURN.footprint.d,
    color:Number.parseInt(String(FURN.color).replace('#',''),16),
    area:FURN.area,desc:FURN.description,fixture:FURN.fixture,
  });

  function authoredVisibleData(data) {
    if(!data||!Array.isArray(data.parts))return null;
    return {...data,parts:data.parts.filter(part=>!part?.foliageFurnitureProxy&&!part?.foliageSeatProxy)};
  }

  function applyAuthoredFoliageTransform(group,data) {
    const plant=group?.getObjectByName?.('lifeTotemFurniturePlant'), t=data?.foliageFurniture?.transform;
    if(!plant||!t)return;
    plant.position.set(Number(t.x)||0,Number(t.y)||0,Number(t.z)||0);
    plant.rotation.set(
      THREE.MathUtils.degToRad(Number(t.rx)||0),
      THREE.MathUtils.degToRad(Number(t.ry)||0),
      THREE.MathUtils.degToRad(Number(t.rz)||0)
    );
    plant.scale.set(
      Math.max(0.001,Number(t.sx)||1),
      Math.max(0.001,Number(t.sy)||1),
      Math.max(0.001,Number(t.sz)||1)
    );
    plant.updateMatrixWorld(true);
    group.userData.lifeTotemFoliageTransform={...t};
  }

  function applyLiquidGlow(authored) {
    const liquidCfg=CFG.basin.material, lightCfg=CFG.basin.light;
    authored?.traverse?.(object=>{
      const part=object?.userData?.authoredPart;
      if(!part?.[CFG.basin.liquidPartFlag]||!object?.isMesh)return;
      const color=CFG.colors.liquid;
      const oldMaterials=(Array.isArray(object.material)?object.material:[object.material]).filter(Boolean);

      // Visible color and emitted light are deliberately separate. An unlit
      // surface keeps the exact authored green instead of washing toward white
      // under the scene/its own PointLight.
      const material=new THREE.MeshBasicMaterial({
        color,
        transparent:liquidCfg.transparent===true,
        opacity:Number(liquidCfg.opacity),
        depthWrite:liquidCfg.depthWrite===true,
        depthTest:true,
        side:THREE.DoubleSide,
      });
      material.name='lifeTotemFontLiquidMaterial';
      material.toneMapped=false;
      object.material=material;
      object.castShadow=false;
      object.receiveShadow=false;
      object.userData.lifeTotemAuthoritativeLiquidMaterial=true;
      object.userData.lifeTotemLiquidModel=liquidCfg.model;
      object.userData.lifeTotemPointLight=
        window.DeadzoneBillboard?.addConfiguredPointLight?.(object,lightCfg,'lifeTotemBasinPointLight')||null;
      oldMaterials.forEach(old=>old!==material&&old.dispose?.());
    });
  }

  function attachAuthoredParts(group,data,baseColor) {
    if(!group||group.userData.lifeTotemAuthoredPartsAttached)return;
    applyAuthoredFoliageTransform(group,data);
    const visibleData=authoredVisibleData(data);
    if(!visibleData?.parts?.length||!window.AuthoredFurniture?.buildGroup)return;
    const authored=window.AuthoredFurniture.buildGroup(visibleData,baseColor);
    authored.name='lifeTotemEditableFurnitureParts';
    authored.userData.lifeTotemEditableFurnitureParts=true;
    applyLiquidGlow(authored);
    group.add(authored);
    group.userData.lifeTotemAuthoredPartsAttached=true;
    group.userData.lifeTotemAuthoredPartCount=visibleData.parts.length;
  }

  function build(options={}) {
    if(!window.THREE||!window.RootTotemPlants?.buildRootTotemPlant)return new window.THREE.Group();
    const recipe={...CFG.canonicalRecipe,...(options.rootTotemPlant||options.recipe||options||{})};
    const group=new THREE.Group();
    group.name='lifeTotemFurniture';
    Object.assign(group.userData,{
      lifeTotemFurniture:true,authoredFurnitureKey:KEY,furnitureKey:KEY,
      lifeTotemRecipe:{...recipe},lifeTotemLiquidColor:CFG.colors.liquid,
    });

    const plant=window.RootTotemPlants.buildRootTotemPlant(recipe);
    plant.name='lifeTotemFurniturePlant';
    group.add(plant);
    group.userData.projectileCoverHeightTiles=window.RootTotemPlants.normalizeConfig(recipe).height;
    group.userData.projectileCoverRadiusTiles=Number(FURN.projectileCoverRadiusTiles);

    const cached=window.AuthoredFurniture?.peek?.(KEY);
    if(cached)attachAuthoredParts(group,cached,options.baseColor);
    else if(window.AuthoredFurniture?.load) {
      window.AuthoredFurniture.load(KEY)
        .then(data=>attachAuthoredParts(group,data,options.baseColor))
        .catch(error=>console.warn('[life totem] authored base failed to load:',error));
    }
    return group;
  }

  window.LifeTotemFurniture={
    CONFIG:CFG,KEY,ITEM_KEY,DEF,authoredVisibleData,applyAuthoredFoliageTransform,
    applyLiquidGlow,attachAuthoredParts,build,
  };
})();
