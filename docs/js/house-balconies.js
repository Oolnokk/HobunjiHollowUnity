// House balconies: author-time face generation shared with the exported piece renderer.
// The top deck is a reachable support; only its exposed footprint edges receive rails.
(function (global) {
  'use strict';
  if (global.HouseBalconies) return;
  const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const cellKey = (x, y) => x + ',' + y;
  const valid = cell => Number.isInteger(cell?.x) && Number.isInteger(cell?.y);

  function normalize(piece) {
    const tile = Math.max(.05, number(piece?.tileSize, 1)); // Used for every face and perimeter measurement.
    const ground = number(piece?.base?.groundY, 0); // Bottom datum of the owning building.
    const wallTop = ground + Math.max(.05, number(piece?.base?.height, 1.4)); // Wall-height mode resolves here, not at runtime from an unrelated roof.
    return (Array.isArray(piece?.balconies) ? piece.balconies : []).map((entry, index) => {
      const cells = [...new Map((entry?.cells || []).filter(valid).map(c => [cellKey(c.x, c.y), {x:c.x,y:c.y}])).values()]; // Deduplicated authored footprint.
      const height = entry?.heightMode === 'wall' ? wallTop : number(entry?.height, wallTop); // Deck top in piece-local Y.
      return {
        id: String(entry?.id || 'balcony_' + index), cells, height, tile,
        railHeight: Math.max(.25, Math.min(2, number(entry?.railHeight, .72))),
        railings: entry?.railings !== false,
        access: entry?.access || null, // A furniture/interior interaction handles the climb; the deck does not create a ground stair.
      };
    }).filter(entry => entry.cells.length);
  }

  function generateFaces(piece) {
    const balconies = normalize(piece);
    const faces = [];
    let nextId = 1;
    const grid = Math.max(1, number(piece?.gridSize, 18)); // Converts painted grid cells to local geometry coordinates.
    const cellRect = (x, y, tile) => ({
      x0: (x-grid/2)*tile, x1: (x+1-grid/2)*tile,
      z0: (y-grid/2)*tile, z1: (y+1-grid/2)*tile
    });
    function face(tag, vertices, detail) {
      faces.push(Object.assign({ id:'balcony_generated_'+nextId++, tag, v:vertices,
        balconyGenerated:true, color:null }, detail || {}));
    }
    function box(x0, x1, y0, y1, z0, z1, type, id) {
      const p = (x,y,z) => [x,y,z], detail = {extensionType:'balcony',balconyId:id,extensionFace:type};
      face('railing', [p(x0,y1,z0),p(x1,y1,z0),p(x1,y1,z1),p(x0,y1,z1)], detail);
      face('railing', [p(x0,y0,z1),p(x1,y0,z1),p(x1,y0,z0),p(x0,y0,z0)], detail);
      face('railing', [p(x0,y0,z0),p(x1,y0,z0),p(x1,y1,z0),p(x0,y1,z0)], detail);
      face('railing', [p(x1,y0,z0),p(x1,y0,z1),p(x1,y1,z1),p(x1,y1,z0)], detail);
      face('railing', [p(x1,y0,z1),p(x0,y0,z1),p(x0,y1,z1),p(x1,y1,z1)], detail);
      face('railing', [p(x0,y0,z1),p(x0,y0,z0),p(x0,y1,z0),p(x0,y1,z1)], detail);
    }
    for (const balcony of balconies) {
      const occupied = new Set(balcony.cells.map(c=>cellKey(c.x,c.y))); // Neighbor test for open deck edges and rail placement.
      const boundary = [];
      const y = balcony.height, thickness = Math.max(.08, balcony.tile * .12);
      for (const cell of balcony.cells) {
        const r = cellRect(cell.x,cell.y,balcony.tile);
        const meta = {extensionType:'balcony',balconyId:balcony.id,extensionFace:'top',sourceTile:{x:cell.x,y:cell.y}};
        face('balcony',[ [r.x0,y,r.z1],[r.x1,y,r.z1],[r.x1,y,r.z0],[r.x0,y,r.z0] ],meta);
        face('balcony',[ [r.x0,y-thickness,r.z0],[r.x1,y-thickness,r.z0],[r.x1,y-thickness,r.z1],[r.x0,y-thickness,r.z1] ],
          {...meta,extensionFace:'underside'});
        for (const [dx,dz,side] of [[0,-1,'north'],[0,1,'south'],[-1,0,'west'],[1,0,'east']]) {
          if (occupied.has(cellKey(cell.x+dx,cell.y+dz))) continue;
          let a,b;
          if (side==='north') { a=[r.x0,r.z0]; b=[r.x1,r.z0]; }
          if (side==='south') { a=[r.x0,r.z1]; b=[r.x1,r.z1]; }
          if (side==='west') { a=[r.x0,r.z0]; b=[r.x0,r.z1]; }
          if (side==='east') { a=[r.x1,r.z0]; b=[r.x1,r.z1]; }
          face('balcony',[[a[0],y-thickness,a[1]],[b[0],y-thickness,b[1]],[b[0],y,b[1]],[a[0],y,a[1]]],
            {...meta,extensionFace:side});
          boundary.push({side,a,b});
        }
      }
      if (!balcony.railings) continue;
      // Merge collinear neighboring exposed edges into one beam per straight run.
      const runs = [];
      for (const side of ['north','south','west','east']) {
        const edges = boundary.filter(e=>e.side===side).map(e=>{
          const horizontal=side==='north'||side==='south';
          return {fixed:horizontal?e.a[1]:e.a[0],lo:horizontal?e.a[0]:e.a[1],hi:horizontal?e.b[0]:e.b[1],horizontal};
        }).sort((a,b)=>a.fixed-b.fixed||a.lo-b.lo);
        for (const e of edges) {
          const last = runs[runs.length-1];
          if(last?.side===side && last.fixed===e.fixed && Math.abs(last.hi-e.lo)<.00001) last.hi=e.hi;
          else runs.push({...e,side});
        }
      }
      const rail = Math.max(.055,balcony.tile*.09);
      const top = y+balcony.railHeight, mid = y+balcony.railHeight*.53;
      const postPositions = new Set(); // Avoid duplicated corner posts where two runs meet.
      for (const run of runs) {
        const half=rail/2;
        if (run.horizontal) {
          box(run.lo,run.hi,top-rail,top,run.fixed-half,run.fixed+half,'rail',balcony.id);
          box(run.lo,run.hi,mid-rail/2,mid+rail/2,run.fixed-half,run.fixed+half,'rail',balcony.id);
        } else {
          box(run.fixed-half,run.fixed+half,top-rail,top,run.lo,run.hi,'rail',balcony.id);
          box(run.fixed-half,run.fixed+half,mid-rail/2,mid+rail/2,run.lo,run.hi,'rail',balcony.id);
        }
        for(const distance of [run.lo,run.hi]){
          const x=run.horizontal?distance:run.fixed, z=run.horizontal?run.fixed:distance;
          postPositions.add(x+','+z);
        }
      }
      for(const entry of postPositions){
        const [x,z]=entry.split(',').map(Number),half=rail*.7;
        box(x-half,x+half,y,top,z-half,z+half,'post',balcony.id);
      }
    }
    return faces;
  }

  function regenerate(piece) {
    if (!piece?.base || !Array.isArray(piece.base.faces)) return piece;
    const source = piece.base.faces.filter(face=>!face.balconyGenerated
      && !(piece.roof?.style==='flat-balcony' && (face.tag==='roof' || face.roofRidgeCap))); // Preserve non-roof walls, doors, entry tunnels, wraparound porches.
    piece.base.faces = source.concat(generateFaces(piece));
    return piece;
  }

  global.HouseBalconies = Object.freeze({normalize,generateFaces,regenerate});
})(typeof window !== 'undefined' ? window : globalThis);
