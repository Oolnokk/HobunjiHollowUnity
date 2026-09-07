// Reuses the Furniture Author Placement image catalog for surface decals.
(() => {
'use strict';
const q=id=>document.getElementById(id);
let selectedKey=null;

function selectedSurfaceRecord(){
  const surface=typeof selectedSurface==='function'?selectedSurface():null;
  if(surface)return surface;
  const ids=typeof activeSurfaceIds==='function'?activeSurfaceIds():[];
  return ids?.length?surfaceGroups.get(ids[ids.length-1]):null;
}
function catalog(){try{return Array.isArray(itemCatalog)?itemCatalog:[];}catch{return[];}}
function selectedItem(){return catalog().find(item=>item.key===selectedKey)||null;}
function render(){
  const list=q('decalCatalogList');if(!list)return;
  const query=(q('decalCatalogSearch')?.value||'').trim().toLowerCase();
  const rows=catalog().filter(item=>!query||`${item.name} ${item.key} ${item.category||''}`.toLowerCase().includes(query)).slice(0,120);
  list.innerHTML=rows.map(item=>`<div class="thumbItem ${item.key===selectedKey?'sel':''}" data-decal-catalog-key="${escapeHtml(item.key)}">${item.imageUrl?`<img loading="lazy" src="${escapeHtml(item.imageUrl)}" alt="">`:''}<div class="thumbName">${escapeHtml(item.name)}</div><div class="thumbMeta">${escapeHtml(item.category||item.source||'Repository')}</div></div>`).join('')||'<div class="muted">No matching Placement images.</div>';
  list.querySelectorAll('[data-decal-catalog-key]').forEach(el=>el.onclick=()=>{selectedKey=el.dataset.decalCatalogKey;render();});
  const status=q('decalCatalogStatus');if(status)status.textContent=`${catalog().length} Placement-mode images available`;
}
function addSelected(){
  const surface=selectedSurfaceRecord(),item=selectedItem();
  if(!surface){log('Select a recognized furniture surface first.','warn');return;}
  if(!item){log('Select an image from the Placement catalog first.','warn');return;}
  if(!Array.isArray(state.decals))state.decals=[];
  state.decals.push({
    id:uid('decal'),name:item.name||'Furniture Decal',surfaceId:surface.id,surfacePartId:surface.partId,
    surfaceType:surface.recognizedType||'',surfaceFaces:[...(surface.faceIndices||[])],imageSource:item.imageUrl,
    imageName:item.path||item.name||item.key,offsetU:0,offsetV:0,width:.5,height:.5,rotationDeg:0,normalOffset:.003,opacity:1,visible:true,
    sourceCatalogKey:item.key,sourceCatalog:'placement'
  });
  rebuildFurnitureMeshes();updateStats?.();queueUndoHistory?.('add catalog furniture decal');
  log(`Added Placement-catalog decal ${item.name} to ${surface.recognizedType||'surface'}.`);
}
function install(){
  const panel=q('furnitureDecalPanel');if(!panel||q('decalPlacementCatalog'))return;
  const block=document.createElement('div');block.id='decalPlacementCatalog';block.innerHTML=`<hr><h3 style="margin:6px 0">Placement Image Catalog</h3><div class="muted tight">Same live image set used by Placement mode; no upload required.</div><input id="decalCatalogSearch" placeholder="Search Placement images…"><div id="decalCatalogStatus" class="muted tight"></div><div id="decalCatalogList" class="thumbList" style="max-height:280px;overflow:auto;margin-top:6px"></div><button id="addSelectedCatalogDecal" class="ok" style="margin-top:6px;width:100%">＋ Add Selected Catalog Image to Surface</button>`;
  const uploadButton=q('addFurnitureDecal');
  if(uploadButton){uploadButton.textContent='Upload Custom Image (optional)';uploadButton.classList.remove('ok');}
  panel.insertBefore(block,q('furnitureDecalList'));
  q('decalCatalogSearch').addEventListener('input',render);q('addSelectedCatalogDecal').onclick=addSelected;
  const originalRender=typeof renderItemCatalog==='function'?renderItemCatalog:null;
  if(originalRender&&!window.__decalCatalogRenderWrapped){renderItemCatalog=function(...args){const out=originalRender(...args);render();return out;};window.__decalCatalogRenderWrapped=true;}
  render();
}
install();
})();
