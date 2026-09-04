// Root Totem visual/runtime configuration.
//
// Keep Root Totem-specific tuning here rather than scattering numbers through
// the plant builder, suspension helper, world renderer, or furniture composer.
(() => {
  'use strict';

  const cfg = {
    schema: 'hobunji_root_totem_config.v2',
    assets: {
      bottleSprite: 'assets/objectsprites/bottle_potion.png',
      ropeTexture: 'assets/textures/wavy_surface.png',
    },
    colors: { liquid: '#7fe7c4', rope: '#6b4728' },
    limits: {
      treeCount:{min:2,max:6}, height:{min:0.3,max:10}, turns:{min:-5,max:5}, radius:{min:0,max:2},
      crossSectionScale:{min:0.03,max:1}, hostSway:{min:0,max:1}, hostSamples:{min:8,max:96}, followerWobble:{min:0,max:0.5},
      followerWobbleFrequency:{min:0,max:12}, rootLockFraction:{min:0,max:0.4}, rootLockTransition:{min:0.01,max:0.4},
      envelopeRadialQuantile:{min:0.3,max:0.9}, glowCount:{min:1,max:7}, glowRadius:{min:0.04,max:0.5}, glowSpriteScale:{min:0.25,max:6},
      glowBottleYScale:{min:0.2,max:2}, glowRopeLength:{min:0.02,max:1.5}, glowRopeRadius:{min:0.002,max:0.08}, glowWindResponse:{min:0,max:4},
    },
    defaults: {
      sourceTree:'crownedPine', treeCount:3, height:3.65, turns:1.75, radiusStart:0.24, radiusEnd:0.13,
      crossSectionScaleStart:0.19, crossSectionScaleEnd:0.15, hostSway:0.11, hostSamples:30, followerWobble:0.018,
      followerWobbleFrequency:2.4, rootLockFraction:0.12, rootLockTransition:0.1, envelopeRadialQuantile:0.58,
      glowCount:3, glowRadius:0.12, glowSpriteScale:1, glowBottleYScale:0.8, glowRopeLength:0.22, glowRopeRadius:0.012, glowWindResponse:1,
    },
    canonicalRecipe: {
      seedU32:7319, sourceTree:'shadewood', treeCount:3, height:1.35, turns:1.75, radiusStart:0, radiusEnd:0.11,
      crossSectionScaleStart:0.27, crossSectionScaleEnd:0.14, hostSway:0.11, hostSamples:30, followerWobble:0.018,
      followerWobbleFrequency:2.4, rootLockFraction:0.12, rootLockTransition:0.1, envelopeRadialQuantile:0.58, glowCount:3, glowRadius:0.12,
    },
    growth: { fallbackSeedLabel:'root_totem', envelopeMinimumRadius:0.025, diagnosticsHistoryLimit:40 },
    shadewoodSurface: {
      enabled:true,
      reuseNaturalSurfaceMaterials:true,
      trunkSurface:'trunks',
      vineSurface:'vines',
      vineCountScale:0.5,
      vineRadiusScale:2,
      minVineStrands:1,
      vineGreenDominanceThreshold:0.015,
      shellOutline:true,
    },
    glowPlacement: {
      verticalStart:0.58, verticalSpan:0.25, verticalJitter:0.035, verticalMin:0.5, verticalMax:0.9,
      envelopeRadiusScale:0.82, radialJitter:0.05, minimumRadialDistance:0.04,
      bottleRadiusScaleMin:0.78, bottleRadiusScaleSpan:0.4, ropeLengthScaleMin:0.9, ropeLengthScaleSpan:0.2,
    },
    bottle: {
      billboard: { rotationLerp:0.18, alphaTest:0.02, noOutline:true },
      rope: {
        color:'#6b4728', radialScale:2.25, lengthScale:2, sideCount:5,
        taperRatio:0.94, textureRepeatWorldLength:0.09, shellOutline:true,
        shellThicknessScale:0.18,
      },
      wind: {
        spatialPhaseX:1.7, spatialPhaseZ:2.3, calmStrength:0.03, maximumStrengthScale:4,
        primaryFrequency:1.6, secondaryFrequency:1.1, secondaryAmplitudeRatio:0.45, secondaryPhaseMultiplier:1.3,
        ropeAmplitudeDegAtCalm:4.6, ropeSwingMaxDeg:18, bottleAmplitudeScale:0.32, bottlePhaseLag:0.22, bottleSwingMaxDeg:8,
      },
      light: {
        enabled:true, color:'#7fe7c4', intensity:0.85, distance:3.2, decay:1.7,
        weatherOverlayMask:true, offset:{x:0,y:-0.02,z:0},
      },
    },
    basin: {
      authoredFurnitureKey:'lifeTotem',
      liquidPartFlag:'lifeTotemFontLiquid',
      material:{model:'unlit',opacity:0.78,depthWrite:false,transparent:true},
      light:{
        enabled:true,color:'#7fe7c4',intensity:1.25,distance:4.2,decay:1.7,
        weatherOverlayMask:true,offset:{x:0,y:0.08,z:0},
      },
    },
    furniture: {
      itemKey:'lifeTotemFurniture', icon:'🌿', name:'Life Totem', price:0,
      footprint:{w:1,d:1}, color:'#66645f', area:'any',
      description:'A living Root Totem surrounded by an editable authored furniture assembly.',
      fixture:true, projectileCoverRadiusTiles:0.48,
    },
  };

  const freeze=value=>{
    if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
    for(const child of Object.values(value))freeze(child);
    return Object.freeze(value);
  };
  window.HOBUNJI_ROOT_TOTEM_CONFIG=freeze(cfg);
})();
