// Named Harlyao lich guardians. Ordinary liches keep the baseline spell AI.
(() => {
  'use strict';
  const DATA = Object.freeze({
    hronal: { id:'azgarlu', name:'Azgarlu of the Flame', tomb:"Azgarlu's Tomb", key:'azgarlu_key_stone', glyph:'harlyao_glyph_entropy', ink:'#ff8526', dye:'dye:CLOTH:pure_orange', scale:{x:1.30,y:1.20,head:1}, weapon:'warhammer_nativeCopper' },
    tothal: { id:'nanahi', name:'Nanahi the Unsleeping', tomb:"Nanahi's Tomb", key:'nanahi_key_stone', glyph:'harlyao_glyph_servitude', ink:'#f0f9ff', dye:'dye:CLOTH:pale_blue', scale:{x:.80,y:1.30,head:1} },
    kanthic: { id:'imlao', name:'Imlao the Sightless', tomb:"Imlao's Tomb", key:'imlao_key_stone', glyph:'harlyao_glyph_ignorance', ink:'#a899eb', dye:'dye:CLOTH:dark_muted_blue_indigo', scale:{x:1,y:1,head:1} },
  }); // Boss metadata drives wardrobe, region title, key-stone and combat state.
  const TILE_FALLBACK = 64; // Used in isolated tests when BanditCombat has not supplied gameplay dependencies.
  const CHARGE_INTERVAL = 18; // Seconds between Kanthic charge sequences.
  const KNEEL_INTERVAL = 13; // Seconds between Tothal's overlapping ceiling barrages.
  const CHARGE_SPEED_TILES = 10; // Horizontal speed while Imlao dives in a straight line.
  const activePatches = new Set(); // Each finite tile-plasm handle is disposed on timeout or exit.
  const droplets = new Set(); // Reused bounded drip particles for Imlao's plasm transformation.
  let lastEvent = 'idle'; // Mobile diagnostic showing last special-lich action.

  const BOSS_DEFAULTS = Object.freeze({ // Single runtime fallback values exposed in the Workshop; authored overrides are optional.
    hronal:Object.freeze({switchSeconds:3.4,meleeCooldownSeconds:1.45,meleeDamage:21}),
    tothal:Object.freeze({specialCooldownSeconds:13,kneelDurationSeconds:4.8,barrageIntervalSeconds:.62}),
    kanthic:Object.freeze({specialCooldownSeconds:18,chargeSpeedTiles:10,chargeCount:4,chargeMaxTiles:8,blastRadiusTiles:2.4,blastDamage:22,plasmDurationSeconds:12}),
  });
  function kindFor(type) {
    const name = DATA[String(type || '').toLowerCase()];
    return name ? 'lich:' + type + ':' + name.id : null; // Full workshop kind distinguishes a named boss from the ordinary tradition.
  }
  function ruleFor(type) { return window.EnemyLoadoutRules?.ruleFor?.(kindFor(type)) || {}; } // Shared exported enemy-loadouts.json is the only tuning store.
  function defFor(type) {
    const key = String(type || '').toLowerCase(), base = DATA[key];
    if (!base) return null;
    const appearance = ruleFor(key).bossAppearance || {}; // Optional Workshop appearance overrides are applied at spawn and map decoration time.
    return {...base,glyph:appearance.glyphId || base.glyph,ink:appearance.ink || base.ink,dye:appearance.robeDye || base.dye,weapon:appearance.weaponKey || base.weapon};
  }
  function rigScaleFor(type) {
    const data=DATA[type];if(!data)return null;
    const gender=type==='tothal'?'female':'male'; // Reference Harlyao skeleton body for literal percent changes.
    const base=window.HobunjiCharacterRigScale?.scaleFor?.('harlyao-skeleton',gender) || {x:1,y:1,head:1,offsetY:0};
    return {x:base.x*data.scale.x,y:base.y*data.scale.y,head:base.head*(data.scale.head||1),offsetY:base.offsetY||0};
  }
  function settingsFor(type) { return {...BOSS_DEFAULTS[type],...(ruleFor(type).bossSettings || {})}; } // Per-actor snapshot prevents mid-fight editor edits changing live timing.
  function setting(actor,key,fallback) { return Number(actor?._specialBossSettings?.[key]) || fallback; } // Validated nonzero numeric fields, defaulting safely in isolated tools.
  function glyphPattern(def) {
    const cached = window.RepoPatternLibrary?.getCachedById?.(def.glyph); // Uses the same authored Harlyao glyph definition as ruin decorations.
    const fallback = 'assets/patterns/motif_' + def.glyph + '.png'; // Visible even when the pattern library has not loaded yet.
    return cached?.pattern || {repoPatternId:def.glyph,motifUrl:fallback,motifScale:1,tiling:true};
  }
  // Workshop-authored cloth/weapon pattern (inline data or a library id) for one named guardian, else its canonical glyph.
  function patternFor(type, kind) {
    const authored = ruleFor(type).bossAppearance?.[kind]; // 'clothingPattern' | 'weaponPattern'
    const resolved = authored?.pattern || (authored?.patternLibraryId && window.PatternLibrary?.getById?.(authored.patternLibraryId)) || null;
    return resolved || glyphPattern(defFor(type));
  }
  function bodyColor3For(type) {
    const rule = ruleFor(type); // Named guardian C is a single deterministic light color; the corresponding ruin must not roll a different shade.
    const choices = Object.entries(rule.dyes?.C || {}).filter(([,weight]) => Number(weight) > 0).sort((a,b) => Number(b[1])-Number(a[1]));
    const authored = choices[0]?.[0]; // Highest-weight authored Color C swatch wins for a named guardian, rather than changing each spawn.
    if (/^#[0-9a-f]{6}$/i.test(authored || '')) return authored;
    const dye = authored && (window.ScratchbonesAccount?.getDyeCatalog?.() || window.SCRATCHBONES_CONFIG?.game?.dyes?.catalog || []).find(item=>item.id===authored);
    if (/^#[0-9a-f]{6}$/i.test(dye?.hex || '')) return dye.hex;
    const explicit = ruleFor(type).bossAppearance?.ink; // Workshop "Body Color 3" override.
    return /^#[0-9a-fA-F]{6}$/.test(explicit || '') ? explicit : inverseRobeColor(type);
  }
  function dyeHex(dyeId) {
    const catalog = window.ScratchbonesAccount?.getDyeCatalog?.() || window.SCRATCHBONES_CONFIG?.game?.dyes?.catalog || [];
    const hex = catalog.find(item => item.id === dyeId)?.hex;
    return /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : null;
  }
  // Body Color 3 defaults to the hue opposite the guardian's primary cloth color, so glow, glyph inlays and flames never share the robe's color family.
  // Lightness/saturation are lifted into a readable emissive range, so a pale or dark robe still gives a vivid glow.
  function inverseRobeColor(type) {
    const robe = dyeHex(defFor(type)?.dye) || '#808080';
    const n = parseInt(robe.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = ((h * 60 + 180) % 360 + 360) % 360; // Opposite hue.
    const l0 = (max + min) / 2, s0 = d ? d / (1 - Math.abs(2 * l0 - 1)) : 0;
    const s = Math.min(1, Math.max(0.7, s0)), l = Math.min(0.68, Math.max(0.55, 1 - l0)); // Light robes give a deeper glow, dark robes a brighter one.
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [rr, gg, bb] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return '#' + [rr, gg, bb].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  }
  // ── Ordinary liches share their tradition's named lich's glyph, with a per-spawn random frame and a random color from the SAME hue family. ──
  function hexToHsl(hex) {
    const n=parseInt(String(hex).slice(1),16), r=(n>>16&255)/255, g=(n>>8&255)/255, b=(n&255)/255, max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
    let h=0;if(d)h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;
    const l=(max+min)/2;return {h:((h*60)%360+360)%360,s:d?d/(1-Math.abs(2*l-1)):0,l};
  }
  function hslToHex(h,s,l) {
    const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;
    const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
    return '#'+[r,g,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');
  }
  const FAMILY={hueSpreadDeg:18,saturation:[.6,1],lightness:[.5,.7]}; // "Same family": within a narrow hue band of the named lich's Body Color 3, with lively saturation/lightness.
  function colorInFamily(baseHex,random) {
    const base=hexToHsl(baseHex), pick=(range)=>range[0]+(range[1]-range[0])*random();
    return hslToHex(((base.h+(random()*2-1)*FAMILY.hueSpreadDeg)%360+360)%360,pick(FAMILY.saturation),pick(FAMILY.lightness));
  }
  const ORDINARY_FRAME={shrink:{min:.4,max:1},rotate:true};
  // clothingPatterns policy for one ordinary lich. Slots are patterned like the named guardians' (same glyph and per-piece scale); the frame varies per piece
  // and `patternColor` (one color per mob, from its tradition's own dye family, never the named lich's hand-authored inverse) is supplied by the caller.
  function ordinaryLichPatterns(type,random=Math.random,patternColor=null) {
    if(!DATA[type])return null;
    const base=patternFor(type,'clothingPattern'), lerp=(a,b,t)=>a+(b-a)*t;
    const color=/^#[0-9a-f]{6}$/i.test(patternColor||'')?patternColor:colorInFamily(bodyColor3For(type),random);
    const forced={};
    for(const [slot,scale] of [['overwear',PATTERN_SCALE.overwear],['pants',PATTERN_SCALE.pants],['hood',PATTERN_SCALE.faceCovering],['mask',PATTERN_SCALE.faceCovering]]) {
      const pattern=JSON.parse(JSON.stringify(base)); // Each piece rolls its own frame, so a robe and its hood differ.
      pattern.frameShape=pattern.frameShape||(pattern.repeatMode==='grid'?'square':'triangle'); // Without a frameShape the weaver takes its legacy path and silently ignores frameScale/frameRotationDeg; 'triangle' is that path's own default geometry.
      pattern.frameScale=Number((Math.max(.05,Number(pattern.frameScale)||1)*lerp(ORDINARY_FRAME.shrink.min,ORDINARY_FRAME.shrink.max,random())).toFixed(4));
      pattern.frameRotationDeg=Math.round(random()*3600)/10;
      forced[slot]={pattern,fallbackColorC:{hex:color},scale,...(slot==='pants'?{roles:['BASE']}:{})}; // Ordinary liches pattern the pants' base sprite; only the named guardians swap base and drape.
    }
    return {forcedOverpassBySlot:forced};
  }
  function applyBodyColor3ToRoster(roster,type) {
    if (!roster || !DATA[type]) return roster;
    const hex=bodyColor3For(type); // One actual body-color channel drives eye pixels, fake lights and every named ruin wall.
    roster.appearance ||= {};
    roster.appearance.bodyColors={...(roster.appearance.bodyColors || {}),C:{hex,tintMode:'hexShadeFill'}};
    roster.appliedDyes && delete roster.appliedDyes.C; // A separately rolled dye must not replace the guardian's wall-matched color.
    if(type==='kanthic') {
      const forbidden=new Set(['hood','hat','mask','upperFace','eyes','facialHair']); // Imlao's bare head is canonical even if a general enemy-clothing preset supplies headwear.
      roster.equippedCosmetics=(roster.equippedCosmetics||[]).filter(id=>{
        const slot=roster.cosmeticSlots?.[id] || window.NpcWardrobe?.slotForCosmetic?.(id) || (/facewrap|hood/i.test(id)?'hood':/circlet|hat|helmet/i.test(id)?'hat':/mask/i.test(id)?'mask':'');
        if(!forbidden.has(slot) || (slot==='hat' && id==='tangedcirclet'))return true; // The circlet is the one allowed headwear.
        if(roster.cosmeticSlots)delete roster.cosmeticSlots[id];
        return false;
      });
      roster.metalArmorItems=(roster.metalArmorItems||[]).filter(item=>!forbidden.has(item.slot) || (item.slot==='hat' && window.MetalArmorSystem?.baseCosmeticId?.(item)==='tangedcirclet') || item.cosmeticId==='tangedcirclet'); // Do not retain invisible hats as potential corpse loot, other than the circlet.
      roster.appearance.cosmetics={...(roster.appearance.cosmetics||{}),hood:'none',mask:'none',upperFace:'none',eyes:'none',facialHair:'none'};
    }
    return roster;
  }
  function decoratePortraitProfile(profile,roster) {
    if (!profile || !roster?.specialLichId) return profile;
    const type=Object.keys(DATA).find(key=>DATA[key].id===roster.specialLichId);
    if (!type)return profile;
    profile.bodyColors={...(profile.bodyColors || {}),C:{hex:roster.appearance?.bodyColors?.C?.hex || bodyColor3For(type)}}; // Override the ordinary skeleton's fixed bone-C guard only for named guardians.
    if (type==='kanthic') {
      const empty={id:'none',layers:[],tintSlot:null}; // Imlao has no hood, hat, face covering, or facial ornament, including randomly forced headwear.
      profile.hood=empty;profile.mask=empty;profile.upperFace=empty;
      if(!/tangedcirclet/.test(profile.hat?.id || ''))profile.hat=empty; // Only the tanged circlet every guardian wears (over its hidden flame headband) is allowed.
      profile.facialHair=empty;profile.eyes=empty;
      return profile;
    }
    const url='cosmetics/appearance/harlyao_skeleton/hskel_eyeglow_'+(type==='tothal'?'f':'m')+'.png'; // Uses the user-uploaded skeleton appearance PNG for each named guardian.
    const pixelDye={sourceHex:'#7F00FF',paletteColorKey:'C',defaultHex:bodyColor3For(type),glow:{blur:3,radius:.65,intensity:3.5}}; // Same exact purple-marker family, two-layer dye and emissive eye lighting as the Hachutu binding mask.
    const base={url,ax:0,ay:0,sx:1,sy:1,pos:'front',xformPreset:'B',pixelDye};
    profile.eyes={id:'special_hskel_eyeglow_'+type,slot:'eyes',tintSlot:null,layers:[base,{...base,pixelDyeOnly:true,paletteColorKey:'C'}]};
    return profile;
  }

  function specialRoster(type) {
    const def = defFor(type);
    if (!def) return null;
    const cosmetics = type === 'hronal'
      ? ['draped_pants','tankan_bodywrap','rounded_pauldron','tangedcirclet']
      : type === 'tothal' ? ['facewrap','tankan_bodywrap','draped_pants','tangedcirclet'] : ['tankan_bodywrap','draped_pants','tangedcirclet']; // All three guardians wear a tanged circlet.
    const slots = {draped_pants:'pants',tankan_bodywrap:'overwear',rounded_pauldron:'pauldron',tangedcirclet:'hat',facewrap:'hood'}; // Facewrap is the existing face-covering hood-slot cosmetic, not a floating mask attachment.
    const appliedDyes = {CLOTH:def.dye,HOOD:def.dye,PANTS:def.dye,MASK:def.dye}; // Existing authored dye channels, not shader-only cosmetic tint.
    const roster = { name:def.name, appearance:{speciesId:'harlyao-skeleton',gender:type==='tothal'?'female':'male',cosmetics:{}},
      equippedCosmetics:cosmetics, cosmeticSlots:Object.fromEntries(cosmetics.map(id=>[id,slots[id]])), appliedDyes,
      lichType:type, lichDyeId:def.dye, specialLichId:def.id, glyphPatternId:def.glyph,
      flameHeadband:{cosmeticId:'basic_headband',hex:MARKER_HEX,hidden:true}, // Invisible marker-dyed headband under the circlet; see prepareHeadFire.
      clothingPatterns:{forcedOverpassBySlot:{
        // Each piece has its own pattern size (scale multiplies the pattern's authored size): pants 4x, robe and face coverings 1.05x.
        overwear:{pattern:patternFor(type,'clothingPattern'),fallbackColorC:{hex:bodyColor3For(type)},scale:PATTERN_SCALE.overwear}, // Garb is visibly woven with its own named Harlyao glyph.
        hood:{pattern:patternFor(type,'clothingPattern'),fallbackColorC:{hex:bodyColor3For(type)},scale:PATTERN_SCALE.faceCovering}, // Face wraps (hood slot).
        mask:{pattern:patternFor(type,'clothingPattern'),fallbackColorC:{hex:bodyColor3For(type)},scale:PATTERN_SCALE.faceCovering}, // Face masks, if one is ever worn.
        pants:{pattern:patternFor(type,'clothingPattern'),fallbackColorC:{hex:bodyColor3For(type)},scale:PATTERN_SCALE.pants,roles:['DRAPE'],baseUsesPatternColor:true}, // The DRAPE carries the main color and the pattern; the BASE is dyed the pattern color (Body Color 3) as a whole.
      }},
    };
    {
      const armor = window.MetalArmorSystem; // Existing forged circlet (and Azgarlu's pauldron) must follow the same rendering/loot rules as skeletal minions.
      const gender = type === 'tothal' ? 'female' : 'male';
      roster.metalArmorItems = (type === 'hronal' ? ['rounded_pauldron','tangedcirclet'] : ['tangedcirclet']).map(id => {
        const item = armor?.makeCraftedItem?.(id,'nativeCopper');
        if (item) {
          item.temperXp = armor.MAX_TEMPER_XP;
          item.sprite = armor.spriteForBlueprintAppearance?.(id,{speciesId:'harlyao-skeleton',gender});
          item.verdigrisPatternId = def.glyph; // Diagnostic identity for the guardian's glyph.
          // Silver plating PAINTED with the guardian's pattern (not verdigris removal). It travels with the item as loot; the paint color is its own
          // field, so it can be re-dyed, but the treatment cannot be re-authored or reworked (see MetalArmorSystem 'painted').
          item.smithTreatment={mode:'painted',metalKey:'silver',pattern:patternFor(type,'clothingPattern'),paintHex:bodyColor3For(type)};
        }
        return item;
      }).filter(Boolean);
    }
    return applyBodyColor3ToRoster(roster,type);
  }

  function patternWarhammer(actor) {
    if (!actor?._specialWarhammerGlyph || actor._specialWarhammerPatternRequested || typeof document==='undefined') return;
    const holder=actor._banditToolHolder; // The standard BanditCombat weapon holder already knows every grip, strike and two-handed scale.
    if (!holder?.parent) return;
    const mesh=holder.children?.[0]?.userData?.toolPlane; // Target the factory's actual painted weapon, never its shadow/outline or an empty grip placeholder.
    const toolDef=actor._specialToolDeps?.TOOL_ITEM_DEFS?.[actor._specialWeaponKey];
    if(!mesh?.isMesh || !mesh.material?.map || !toolDef?.sprite || !window.ToolMetalRecolor?.getRecoloredCanvas)return; // Wait until the real weapon plane and game definitions exist.
    actor._specialWarhammerPatternRequested=true; // The recolor is requested once per guardian instead of every frame.
    const original=mesh.material, authored=patternFor(actor.lichType,'weaponPattern');
    const motifUrl=authored.motifUrl, pattern=motifUrl && window.resolvePortraitAssetUrl ? {...authored,motifUrl:window.resolvePortraitAssetUrl(motifUrl.replace(/^\.?\/?assets\//,''))} : authored; // Same asset-root resolution metal armor uses for its authored patterns.
    // The tool-metal recolorer is the game's own weapon pattern path: it paints the authored motif only onto the metal-keyed pixels (head), leaving the shaft and outline alone.
    const silver=actor._specialToolDeps?.METAL_DEFS?.silver?.hex || '#C0C0C0'; // Silver-plated, with the pattern PAINTED in Body Color 3 (the recolorer's motif pixels take the paint, the rest the silver).
    window.ToolMetalRecolor.getRecoloredCanvas(toolDef.sprite,{targetHex:bodyColor3For(actor.lichType),verdigrisHex:silver,oxidationAmount:1,authoredPattern:pattern}).then(canvas=>{
      if(!holder.parent || mesh.material!==original || actor._specialWarhammerMaterial)return;
      const texture=window.HobunjiSpritePngSurface.makeCanvasTexture(window.THREE,canvas,'special_warhammer_pattern'); // Shared PNG-plane texture settings, per AGENTS.md.
      const material=original.clone();material.map=texture;material.needsUpdate=true;
      mesh.material=material;
      actor._specialWarhammerMaterial={mesh,original,material,texture}; // Restores/disposes this per-boss patina on clear.
      lastEvent='azgarlu:entropy-verdigris';
    }).catch(error=>{actor._specialWarhammerPatternRequested=false;window.__farmLog?.('[special-lich] warhammer pattern: '+error.message,'warn');}); // Failure leaves the ordinary warhammer in place.
  }
  function releaseWarhammer(actor) {
    const entry=actor?._specialWarhammerMaterial;
    if(!entry)return;
    if(entry.mesh.material===entry.material)entry.mesh.material=entry.original;
    entry.texture.dispose?.();entry.material.dispose?.();
    actor._specialWarhammerMaterial=null;
  }
  function init(entity, type, toolDeps) {
    const spec = defFor(type);
    if (!entity || !spec) return entity;
    entity._specialToolDeps = toolDeps || null; // Tool/metal definitions the weapon pattern recolor reads.
    entity.isSpecialLich = true;
    entity.specialLichId = spec.id;
    entity.name = spec.name;
    entity._specialBossSettings = settingsFor(type); // Workshop attack sliders govern the live boss, not just its preview.
    entity._specialMode = type==='hronal'?'magic':null;
    entity._specialModeClock = 0; // Hronal switches stance and hover on this independent cadence.
    entity._specialHoverBlend = 1; // Lerp target is zero while fighting on foot.
    entity._specialCooldown = type==='kanthic'?8:7; // Special move clock; stagger from initial ordinary cast.
    entity._specialStage = null; // Tothal kneel or Kanthic charge-sequence data.
    entity._specialDripClock = 0; // Limits new droplet meshes to a low fixed rate.
    entity._specialPlasmLastTile = null; // Prevents repeated patches on the same crossed tile.
    entity._specialOriginalMaterials = null; // Restores all original silhouette/alpha materials after plasm transformation.
    if (type==='hronal' && entity._banditToolHolder?.parent && window.THREE?.PointLight) {
      const light=new window.THREE.PointLight(0xff8d37,.64,1.6); // One bounded weapon enchant glow, carried by the real warhammer holder.
      entity._banditToolHolder.add(light);
    }
    if (type==='kanthic') {
      entity._specialSkullTransparent = !!entity.avatarRef?.group?.userData?.skullPixelsTransparent; // Preserve full-scale neck/head bones; the shared portrait builder removes only Imlao's skull pixels.
    }
    lastEvent = 'spawn:' + spec.id;
    return entity;
  }
  function finishStaged(actor) {
    actor._banditAction = null;
    actor.telegraphState = null;
    actor._lichCastingAbility = null;
  }
  function meleeAI(actor,dt,target,deps,angle,dist) {
    if (actor._banditAction) return {aimAngle:angle,moving:false,handled:true};
    const tile = deps?.TILE || TILE_FALLBACK;
    let moving = false;
    if (dist>tile*2.0) moving=!!deps?.moveCreatureToward?.(actor,target.x,target.y,actor.def.chaseSpeed,dt);
    actor._specialMeleeCooldown = Math.max(0,(actor._specialMeleeCooldown||0)-dt);
    if (dist < tile*2.25 && actor._specialMeleeCooldown<=0 && window.Combat?.beginStagedAction) {
      actor.facing = angle;
      actor.telegraphState='windup';
      actor._banditSwingAnim='chop';
      actor._banditSwingPose = null;
      actor._specialMeleeCooldown = setting(actor,'meleeCooldownSeconds',1.45);
      actor._banditAction=window.Combat.beginStagedAction({
        windupS:.29,strikeS:.16,recoverS:.18,
        data:{isBandit:true,attacker:actor,voiceCategory:'heavyAttack'},
        onStrike:()=>{
          actor.telegraphState='strike';
          if (Number(target.health)<=0 || Math.hypot(target.x-actor.x,target.y-actor.y)>tile*2.35) return;
          const a=Math.atan2(target.y-actor.y,target.x-actor.x);
          if (Math.abs(Math.atan2(Math.sin(a-actor.facing),Math.cos(a-actor.facing)))>1.1) return;
          if (window.Combat?.meleeHit && !window.Combat.meleeHit(actor,target,{rangePx:tile*2.35,halfConeRad:1.1,yaw:actor.facing})) return;
          const sourceX=actor.x===target.x?actor.x-1:actor.x;
          const damage=setting(actor,'meleeDamage',21); // Workshop-authored magical warhammer damage.
          const impact={tag:'blunt',attacker:actor,footingDamageMultiplier:2};
          if (target===deps?.player) deps?.damagePlayer?.(damage,sourceX,actor.y,tile*6,impact);
          else deps?.damageCreature?.(target,damage,sourceX,actor.y,tile*6,impact);
          window.AudioSystem?.playWeaponHitSfx?.('blunt',actor.x,actor.y,actor.areaId);
          lastEvent='azgarlu:warhammer';
        },
        onComplete:()=>finishStaged(actor),onCancel:()=>finishStaged(actor),
      });
    }
    return {aimAngle:angle,moving,handled:true};
  }
  function shockwave(actor,deps) {
    const tile=deps?.TILE||TILE_FALLBACK;
    const radius=setting(actor,'blastRadiusTiles',2.4), baseDamage=setting(actor,'blastDamage',22); // Concussive blast tuning uses the same authored settings as the editor.
    for(const victim of [deps?.player,...(deps?.hostileObjects||[])]) {
      if(!victim||victim===actor||Number(victim.health)<=0||victim.areaId && victim.areaId!==actor.areaId)continue;
      const dist=Math.hypot(victim.x-actor.x,victim.y-actor.y);
      if(dist>tile*radius)continue;
      const damage=Math.max(1,Math.round(baseDamage*(1-dist/(tile*(radius+.6)))));
      const sx=dist<1?actor.x-1:actor.x;
      if(victim===deps?.player)deps?.damagePlayer?.(damage,sx,actor.y,tile*12,{footingDamageMultiplier:2,attacker:actor});
      else deps?.damageCreature?.(victim,damage,sx,actor.y,tile*12,{footingDamageMultiplier:2,attacker:actor});
    }
    window.AudioSystem?.playObjectSfxKey?.('shattercaskExplosion');
    lastEvent='imlao:concussive-stop';
  }
  function rememberPlasm(handle,clock=12) {
    if(!handle)return;
    const record={handle,time:clock}; // Same static-tile plasm used by ordinary Kanthic spells; lifetime bound to this charge.
    activePatches.add(record);
  }
  function beginKanthic(actor,target) {
    actor._specialStage={kind:'charge',remaining:setting(actor,'chargeCount',4),travel:0,targetX:target.x,targetY:target.y}; // Per-fight charge count comes from authored boss rules.
    actor._specialPlasmLastTile=null;
    applyPlasmSkin(actor,true);
    lastEvent='imlao:plasm-charge';
  }
  function chargeAI(actor,dt,target,deps,angle) {
    const stage=actor._specialStage, tile=deps?.TILE||TILE_FALLBACK;
    if(!stage||stage.kind!=='charge')return null;
    const dx=stage.targetX-actor.x,dy=stage.targetY-actor.y,dist=Math.hypot(dx,dy);
    if(dist>tile*.45 && stage.travel<tile*setting(actor,'chargeMaxTiles',8)) {
      const speed=setting(actor,'chargeSpeedTiles',CHARGE_SPEED_TILES); // Tiles per second, adjustable per guardian.
      const step=Math.min(dist,speed*tile*dt);
      const direction=Math.atan2(dy,dx);
      actor.facing=direction;
      const moved=deps?.moveCreatureToward?.(actor,actor.x+Math.cos(direction)*step,actor.y+Math.sin(direction)*step,speed*tile,dt);
      stage.travel+=step;
      const tx=Math.floor(actor.x/tile),ty=Math.floor(actor.y/tile),key=tx+','+ty;
      if(key!==actor._specialPlasmLastTile) {
        actor._specialPlasmLastTile=key;
        rememberPlasm(window.DevRandomRuinLichThemes?.createSpellPlasm?.(tx+.5,ty+.5),setting(actor,'plasmDurationSeconds',12));
      }
      return {aimAngle:direction,moving:!!moved,handled:true};
    }
    shockwave(actor,deps);stage.remaining--;
    if(stage.remaining<=0){actor._specialStage=null;applyPlasmSkin(actor,false);actor._specialCooldown=setting(actor,'specialCooldownSeconds',CHARGE_INTERVAL);}
    else {stage.travel=0;stage.targetX=target.x;stage.targetY=target.y;actor._specialPlasmLastTile=null;}
    return {aimAngle:angle,moving:false,handled:true};
  }
  function handleAI(actor,dt,target,deps,angle,dist) {
    if(!actor?.isSpecialLich || !target || Number(target.health)<=0)return null;
    if(actor.lichType==='hronal') {
      if (ruleFor('hronal').specialAttacks?.melee === false) {actor._specialMode='magic';return null;} // Disable boss-specific melee without affecting the underlying Hronal spell.
      actor._specialModeClock+=dt;
      if(actor._specialModeClock>=setting(actor,'switchSeconds',3.4)&&!actor._banditAction) {
        actor._specialModeClock=0;
        actor._specialMode=actor._specialMode==='magic'?'melee':'magic';
        lastEvent='azgarlu:stance-'+actor._specialMode;
      }
      return actor._specialMode==='melee'?meleeAI(actor,dt,target,deps,angle,dist):null;
    }
    actor._specialCooldown=Math.max(0,actor._specialCooldown-dt);
    if(actor.lichType==='tothal') {
      if (ruleFor('tothal').specialAttacks?.blizzard === false) return null; // Workshop toggle excludes Nanahi's barrage without switching off other Tothal spells.
      if(actor._specialStage?.kind==='kneel') {
        const stage=actor._specialStage;
        stage.time-=dt;stage.wave-=dt;
        if(stage.wave<=0) {
          stage.wave=setting(actor,'barrageIntervalSeconds',.62);
          window.DevRandomRuinLichThemes?.triggerBossBlizzard?.(actor);
          lastEvent='nanahi:ceiling-barrage';
        }
        if(stage.time<=0) {actor._specialStage=null;actor._specialCooldown=setting(actor,'specialCooldownSeconds',KNEEL_INTERVAL);lastEvent='nanahi:stand';}
        return {aimAngle:angle,moving:false,handled:true};
      }
      if(actor._specialCooldown<=0&&!actor._banditAction) {
        actor._specialStage={kind:'kneel',time:setting(actor,'kneelDurationSeconds',4.8),wave:0}; // A stationary vulnerable 4.8-second window.
        lastEvent='nanahi:kneel';
        return {aimAngle:angle,moving:false,handled:true};
      }
    }
    if(actor.lichType==='kanthic') {
      if (ruleFor('kanthic').specialAttacks?.plasmCharge === false) return null; // Ordinary Kanthic attacks remain active when the named burst is disabled.
      if(actor._specialStage?.kind==='charge')return chargeAI(actor,dt,target,deps,angle);
      if(actor._specialCooldown<=0&&!actor._banditAction) {
        beginKanthic(actor,target);
        return chargeAI(actor,dt,target,deps,angle);
      }
    }
    return null;
  }
  function retextureMap(source,plasm) {
    const image=source?.image;
    if(!image?.width||!image?.height || typeof document==='undefined')return null;
    const width=Math.min(1024,image.width),height=Math.min(1024,image.height);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');if(!ctx)return null;
    ctx.drawImage(image,0,0,width,height);
    ctx.globalCompositeOperation='source-atop'; // Preserve transparent body/clothing cutout outlines.
    const pattern=plasm?.image;
    ctx.fillStyle='#2d2148';ctx.fillRect(0,0,width,height); // Preserve the dark indigo-violet base of the live Kanthic oil.
    ctx.globalAlpha=.62;
    if(pattern?.width && pattern?.height) {
      for(let y=0;y<height;y+=80)for(let x=0;x<width;x+=80)ctx.drawImage(pattern,x,y,80,80);
    } else {
      ctx.fillStyle='rgba(147,112,190,.5)';
      for(let i=0;i<40;i++){const x=(i*71)%width,y=(i*109)%height;ctx.fillRect(x,y,2,18);}
    }
    ctx.globalAlpha=1;
    const texture=new window.THREE.CanvasTexture(canvas);texture.colorSpace=source.colorSpace;
    return texture;
  }
  function applyPlasmSkin(actor,enabled) {
    if(enabled && actor._specialOriginalMaterials)return;
    if(!enabled) {
      for(const entry of actor._specialOriginalMaterials||[]) {
        entry.mesh.material=entry.base;
        entry.changed.map?.dispose?.();
        entry.changed.dispose?.();
      }
      actor._specialOriginalMaterials=null;
      return;
    }
    const saved=[],plasm=window.DevRandomRuinLichThemes?.plasmTexture?.();
    actor.avatarRef?.group?.traverse?.(mesh=>{
      if(!mesh.isMesh || Array.isArray(mesh.material) || !mesh.material?.map) return;
      const texture=retextureMap(mesh.material.map,plasm);
      if(!texture)return;
      const material=mesh.material.clone();
      material.map=texture;material.color?.set?.('#ffffff');material.needsUpdate=true;
      saved.push({mesh,base:mesh.material,changed:material});
      mesh.material=material;
    });
    actor._specialOriginalMaterials=saved;
  }
  function dropParticle(actor,dt) {
    if(!actor._specialStage || !window.THREE || droplets.size>=36)return;
    actor._specialDripClock+=dt;
    if(actor._specialDripClock<.055)return;
    actor._specialDripClock=0;
    const group=actor.avatarRef?.group; const parent=group?.parent;
    if(!parent)return;
    const mesh=new window.THREE.Mesh(new window.THREE.SphereGeometry(.035,4,3),new window.THREE.MeshBasicMaterial({color:0x6a509d,transparent:true,opacity:.84,depthWrite:false}));
    mesh.position.set(group.position.x+(Math.random()-.5)*.6,group.position.y+(Math.random()-.5)*.7,group.position.z+(Math.random()-.5)*.6);
    parent.add(mesh);
    droplets.add({mesh,time:.45,velocity:.4+Math.random()*.9});
  }
  // ── Flame headband ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // Every guardian wears an invisible plain headband dyed the marker hex (#7F00FF) under its tanged circlet. It is never drawn into the portrait:
  // it only supplies emitter pixels (same marker-pixel idea as a torch-flail's fuel sprite). Flames in Body Color 3 rise from those pixels, are
  // drawn above the head but beneath an overlay plane carrying only the circlet, so the circlet occludes them like a brazier's top sprite.
  const MARKER_HEX='#7F00FF';
  const PATTERN_SCALE=Object.freeze({pants:4,overwear:1.05,faceCovering:1.05}); // Per-piece pattern size overrides (weaving usage multiplier).
  const FIRE={rate:42,life:.8,speed:.18,size:.075,max:44,maxSources:320};
  const headFires=new Set();
  let fireTexture=null;
  const blankPiece={id:'none',tintSlot:null,layers:[]};
  async function prepareHeadFire(profile, roster, renderToCanvas, size=200) {
    if(!profile?.hat?.layers?.length || !roster?.specialLichId || typeof renderToCanvas!=='function')return null;
    const type=Object.keys(DATA).find(key=>DATA[key].id===roster.specialLichId);
    if(!type)return null;
    const isolate=(hat,bodyColors)=>({...profile,bodyColors:bodyColors||profile.bodyColors,hairFront:blankPiece,hairBack:blankPiece,hairSide:blankPiece,hairSideL:blankPiece,hood:blankPiece,mask:blankPiece,eyes:blankPiece,upperFace:blankPiece,facialHair:blankPiece,torsoCosmetic:blankPiece,armCosmetic:blankPiece,pauldron:blankPiece,hat});
    const options={forceEyesOpen:true,headCosmeticsOnly:true,skipHeadSprite:true}; // Hat layers only.
    const headband={...profile.hat,id:'special_flame_headband',layers:profile.hat.layers.map(layer=>({...layer,url:'cosmetics/clothes/hat/headband.png',pixelDye:null,materialKind:null}))};
    const bandCanvas=await renderToCanvas(isolate(headband,{...(profile.bodyColors||{}),HAT:{hex:MARKER_HEX,tintMode:'hexShadeFill'}}),options); // Dyed in the marker hex.
    const indices=window.HobunjiLayeredWeaponEffects?.sourcePixels?.(bandCanvas,MARKER_HEX,'marker') || [];
    if(!indices.length)return null;
    const stride=Math.max(1,Math.ceil(indices.length/FIRE.maxSources)), sources=[];
    for(let i=0;i<indices.length;i+=stride)sources.push({x:((indices[i]%size)+.5)/size,y:(Math.floor(indices[i]/size)+.5)/size});
    const overlayCanvas=await renderToCanvas(isolate(profile.hat),options); // Circlet only: drawn over the flames.
    return {sources,overlayCanvas,type};
  }
  function fireSpriteTexture() {
    if(fireTexture)return fireTexture;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
    const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(16,19,1,16,17,16);
    gradient.addColorStop(0,'rgba(255,255,255,1)');gradient.addColorStop(.35,'rgba(255,255,255,.9)');gradient.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,32,32);
    fireTexture=new window.THREE.CanvasTexture(canvas);
    return fireTexture;
  }
  function ensureHeadFire(actor) {
    if(actor._specialHeadFire || typeof document==='undefined')return;
    const root=actor.avatarRef?.group, data=root?.userData?.specialHeadFire, rig=root?.userData?.neckRig, THREE=window.THREE;
    const neck=rig?.neckLocal, joint=rig?.headScaleJoint, plane=rig?.skinnedPlane;
    if(!data?.sources?.length || !rig?.available || !joint || !neck || !plane || !THREE)return;
    const width=root.userData.portraitModelWidth, height=root.userData.portraitModelHeight; // Same plane-to-bone mapping the portrait glow lights use.
    const group=new THREE.Group();group.name='special_lich_headfire';
    joint.add(group); // Flames follow every head turn, tilt and Head-scale change like skin weighted to the head.
    const base=Number(plane.renderOrder)||0, flameOrder=base+.0003, circletOrder=base+.0006;
    let overlay=null;
    if(data.overlayCanvas) {
      const surface=window.HobunjiSpritePngSurface;
      const texture=surface?.makeCanvasTexture?.(THREE,data.overlayCanvas,'special_lich_circlet') || new THREE.CanvasTexture(data.overlayCanvas);
      window.PNGPlaneAvatar?.trackPortraitTexture?.(THREE,texture,'front'); // Same portrait-flip setting as the base plane, so the circlet is never mirrored against the head it sits on.
      const material=surface?.makeMaterial?.(THREE,texture,'special_lich_circlet',{side:THREE.FrontSide}) || new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.05});
      overlay=new THREE.Mesh(new THREE.PlaneGeometry(width,height),material);
      overlay.name='special_lich_circlet_overlay';overlay.position.set(-neck.x,-neck.y,.003);overlay.renderOrder=circletOrder;overlay.frustumCulled=false;
      group.add(overlay);
    }
    const fire={actor,group,overlay,joint,sources:data.sources,width,height,neck:{x:neck.x,y:neck.y},color:bodyColor3For(data.type),flameOrder,particles:[],pool:[],accumulation:0};
    actor._specialHeadFire=fire;headFires.add(fire);
  }
  function disposeHeadFire(fire) {
    for(const sprite of [...fire.particles.map(p=>p.sprite),...fire.pool]){fire.group.remove(sprite);sprite.material?.dispose?.();}
    fire.overlay?.material?.map?.dispose?.();fire.overlay?.material?.dispose?.();fire.overlay?.geometry?.dispose?.();
    fire.group.parent?.remove?.(fire.group);
    fire.particles.length=0;fire.pool.length=0;
    if(fire.actor)fire.actor._specialHeadFire=null;
    headFires.delete(fire);
  }
  function stepHeadFires(dt) {
    const THREE=window.THREE;
    for(const fire of [...headFires]) {
      const actor=fire.actor;
      if(!fire.group.parent || !actor?.avatarRef?.group?.parent){disposeHeadFire(fire);continue;} // Avatar torn down.
      const alive=Number(actor.health)>0 && actor.state!=='corpse';
      if(fire.overlay)fire.overlay.visible=true;
      for(let i=fire.particles.length-1;i>=0;i--) {
        const particle=fire.particles[i];particle.age+=dt;
        const t=particle.age/particle.life;
        if(t>=1){particle.sprite.visible=false;fire.group.remove(particle.sprite);fire.pool.push(particle.sprite);fire.particles.splice(i,1);continue;}
        particle.sprite.position.x=particle.x+Math.sin(particle.age*13+particle.phase)*.012*t;
        particle.sprite.position.y=particle.y+particle.speed*particle.age;
        particle.sprite.material.opacity=Math.sin(Math.PI*t)*.92;
        particle.sprite.scale.setScalar(particle.size*(.5+t*1.5));
      }
      if(!alive)continue;
      fire.accumulation=Math.min(2,fire.accumulation+dt*FIRE.rate);
      while(fire.accumulation>=1 && fire.particles.length<FIRE.max) {
        fire.accumulation-=1;
        const source=fire.sources[Math.floor(Math.random()*fire.sources.length)];
        let sprite=fire.pool.pop();
        if(!sprite)sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:fireSpriteTexture(),transparent:true,opacity:0,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending}));
        sprite.material.color.set(fire.color); // Tinted Body Color 3.
        sprite.renderOrder=fire.flameOrder; // Above the head, beneath the circlet overlay.
        const flipped=window.PNGPlaneAvatar?.getPortraitsFlipped?.()===true; // Emitters mirror with the portrait, exactly like the portrait glow lights.
        const x=((flipped?1-source.x:source.x)-.5)*fire.width-fire.neck.x, y=(.5-source.y)*fire.height-fire.neck.y;
        sprite.position.set(x,y,.0015);sprite.visible=true;
        fire.group.add(sprite);
        fire.particles.push({sprite,age:0,life:FIRE.life,x,y,speed:FIRE.speed*(.5+Math.random()),phase:Math.random()*6.283,size:FIRE.size});
      }
    }
  }
  function tick(actor,dt) {
    if(!actor?.isSpecialLich)return;
    ensureHeadFire(actor);
    if(actor.lichType==='tothal') {
      const kneel=actor._specialStage?.kind==='kneel',avatar=actor.avatarRef;
      actor._specialKneelBlend=Math.min(1,Math.max(0,(actor._specialKneelBlend||0)+(kneel?dt*4:-dt*4)));
      for(const joint of [avatar?.neckJoint?.front,avatar?.neckJoint?.back])if(joint?.rotation)joint.rotation.x=-.38*actor._specialKneelBlend;
      actor._specialHoverTarget=kneel?0:1;
    }
    if(actor.lichType==='hronal') {
      actor._specialHoverTarget=actor._specialMode==='melee'?0:1;
      patternWarhammer(actor); // Actual verdigris-glyph texture follows the ordinary held warhammer.
    }
    if(actor.lichType==='kanthic') {
      actor._specialHoverTarget=1;
      if(actor._specialStage?.kind==='charge')dropParticle(actor,dt);
    }
  }
  function updateEffects(dt) {
    stepHeadFires(dt);
    for(const item of [...activePatches]) {
      item.time-=dt;
      if(item.time>0)continue;
      item.handle.dispose?.();activePatches.delete(item);
    }
    for(const item of [...droplets]) {
      item.time-=dt;item.mesh.position.y-=item.velocity*dt;
      item.mesh.material.opacity=Math.max(0,item.time/.45)*.84;
      if(item.time>0)continue;
      item.mesh.parent?.remove?.(item.mesh);
      item.mesh.geometry.dispose?.();item.mesh.material.dispose?.();droplets.delete(item);
    }
  }
  function clear() {
    for(const fire of [...headFires])disposeHeadFire(fire);
    for(const item of activePatches)item.handle.dispose?.();
    activePatches.clear();
    for(const item of droplets){item.mesh.parent?.remove?.(item.mesh);item.mesh.geometry.dispose?.();item.mesh.material.dispose?.();}
    droplets.clear();
  }
  window.SpecialHarlyaoLiches=Object.freeze({
    DATA,BOSS_DEFAULTS,patternFor,inverseRobeColor,kindFor,defFor,settingsFor,rigScaleFor,bodyColor3For,applyBodyColor3ToRoster,decoratePortraitProfile,prepareHeadFire,ordinaryLichPatterns,colorInFamily,specialRoster,init,handleAI,tick,updateEffects,applyPlasmSkin,clear, // Workshop consumes the same readable defaults and battle stage constructors.
    releaseWarhammer, // Original weapon material is restored before scene teardown, without disposing shared art assets.
    onDefeat: actor => actor?.isSpecialLich ? window.DelversGuild?.grantKeyStone?.(actor.specialLichId)===true : false,
    snapshot:()=>({event:lastEvent,plasmPatches:activePatches.size,drips:droplets.size}),
  });
})();
