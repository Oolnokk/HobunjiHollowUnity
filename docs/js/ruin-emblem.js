// RuinEmblem — inside a ruin, the generic round decals (the rune ring on glyph targets, ladders and
// signal plates, the seal circle on doors) are replaced by the motif PNG of the ruin's lich
// tradition (the same harlyao glyph the named liches use for their wall patterns).
// Single authority: callers pass the default decal path and get back the path to load.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinEmblem=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const GENERIC=/(?:^|\/)(?:ruin_glyph_rune|ruin_seal_circle)\.png$/i;
  const MOTIFS=Object.freeze({
    hronal:'assets/patterns/motif_harlyao_glyph_entropy.png',
    tothal:'assets/patterns/motif_harlyao_glyph_servitude.png',
    kanthic:'assets/patterns/motif_harlyao_glyph_ignorance.png',
  });
  function theme(){
    try{
      if(root.GridTileAccessors?.getCurrentArea?.()!=='map_i_dev_random_ruin')return null;
      return root.DevRandomRuin?.getRuntimeContext?.()?.theme||null;
    }catch(error){return null;}
  }
  function resolve(path){
    const raw=String(path||'');
    if(!GENERIC.test(raw))return raw;
    return MOTIFS[theme()]||raw; // Outside a ruin (or before its theme is known) the original decal stays.
  }
  return Object.freeze({resolve,MOTIFS,isGeneric:p=>GENERIC.test(String(p||''))});
});
