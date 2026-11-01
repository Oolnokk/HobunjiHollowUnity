// Plans connected furniture roots inside the original mesh volumes; contains no renderer or frame loop.
(function(root){
  'use strict';
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value)); // Shared bounds for voxel resolution and tube budgets.
  function randomFor(seed){let state=2166136261;for(const char of seed)state=Math.imul(state^char.charCodeAt(0),16777619);return()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};}
  function buildTree(T,triangles){
    const box=new T.Box3();for(const triangle of triangles){box.expandByPoint(triangle.a);box.expandByPoint(triangle.b);box.expandByPoint(triangle.c);} // Local-space acceleration keeps imported high-poly details affordable.
    if(triangles.length<=12)return {box,triangles};
    const size=box.getSize(new T.Vector3()),axis=size.x>=size.y&&size.x>=size.z?'x':size.y>=size.z?'y':'z'; // Split along the widest dimension.
    triangles.sort((a,b)=>(a.a[axis]+a.b[axis]+a.c[axis])-(b.a[axis]+b.b[axis]+b.c[axis]));
    const middle=triangles.length>>>1;return {box,left:buildTree(T,triangles.slice(0,middle)),right:buildTree(T,triangles.slice(middle))};
  }
  function makeField(T,mesh,detail){
    const geometry=mesh.geometry,position=geometry.getAttribute('position'),index=geometry.index,triangles=[]; // Read geometry only; authored buffers and transforms remain untouched.
    const end=Math.min(index?.count||position.count,geometry.drawRange.start+geometry.drawRange.count); // Respect GLB material subsets and partial authored geometry.
    for(let i=geometry.drawRange.start;i+2<end;i+=3){const ids=index?[index.getX(i),index.getX(i+1),index.getX(i+2)]:[i,i+1,i+2];triangles.push(new T.Triangle(...ids.map(id=>new T.Vector3().fromBufferAttribute(position,id))));}
    if(!triangles.length)throw new Error('Furniture network has an empty mesh: '+mesh.name);
    const tree=buildTree(T,triangles),inverse=new T.Matrix4().copy(mesh.matrixWorld).invert(),scale=new T.Vector3().setFromMatrixScale(mesh.matrixWorld),minScale=Math.max(1e-6,Math.min(scale.x,scale.y,scale.z)); // Local distances are converted conservatively for nonuniformly scaled parts.
    const hit=new T.Vector3(),nearest=new T.Vector3(),ray=new T.Ray(),direction=new T.Vector3(.931,.273,.241).normalize(); // Reused scratch data for every occupancy/clearance query.
    const nearestPoint=point=>{
      let best=Infinity;const visit=node=>{if(node.box.distanceToPoint(point)**2>best)return;if(node.triangles){for(const triangle of node.triangles){triangle.closestPointToPoint(point,hit);const d=hit.distanceToSquared(point);if(d<best){best=d;nearest.copy(hit);}}}else{const left=node.left.box.distanceToPoint(point),right=node.right.box.distanceToPoint(point);visit(left<right?node.left:node.right);visit(left<right?node.right:node.left);}};visit(tree);return {distance:Math.sqrt(best),point:nearest.clone()};
    };
    const contains=point=>{
      if(!tree.box.containsPoint(point))return false;
      ray.set(point,direction);const distances=[];const visit=node=>{if(!ray.intersectsBox(node.box))return;if(node.triangles){for(const triangle of node.triangles)if(ray.intersectTriangle(triangle.a,triangle.b,triangle.c,false,hit)){const distance=point.distanceTo(hit);if(distance>1e-7)distances.push(distance);}}else{visit(node.left);visit(node.right);}};visit(tree);distances.sort((a,b)=>a-b);let crossings=0,last=-Infinity;for(const distance of distances)if(distance-last>1e-6){crossings++;last=distance;}return crossings%2===1;
    };
    const size=tree.box.getSize(new T.Vector3()),physicalSize=new T.Vector3(size.x*scale.x,size.y*scale.y,size.z*scale.z),resolution=12+Math.round(detail*22),longest=Math.max(physicalSize.x,physicalSize.y,physicalSize.z),dims=[physicalSize.x,physicalSize.y,physicalSize.z].map(value=>Math.max(3,Math.round(value/Math.max(1e-6,longest)*resolution))); // Thin pieces retain at least three samples across their narrowest section.
    while(dims[0]*dims[1]*dims[2]>8192){const axis=dims.indexOf(Math.max(...dims));dims[axis]--;}
    const step=new T.Vector3(size.x/dims[0],size.y/dims[1],size.z/dims[2]),nodes=[],lookup=new Map(); // Interior nodes preserve real holes rather than filling the bounding box.
    const key=(x,y,z)=>x+','+y+','+z;
    for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++){
      const point=new T.Vector3(tree.box.min.x+(x+.5)*step.x,tree.box.min.y+(y+.5)*step.y,tree.box.min.z+(z+.5)*step.z); // Cell centres avoid ambiguous parity directly on guide faces.
      if(!contains(point))continue;const clearance=nearestPoint(point).distance;lookup.set(key(x,y,z),nodes.length);nodes.push({point,clearance,x,y,z,component:-1});
    }
    let surfaceFallback=false;
    if(!nodes.length){ // Open decorative planes still receive a thin surface-following path, without inventing a solid interior.
      surfaceFallback=true;for(const triangle of triangles){const point=triangle.getMidpoint(new T.Vector3());nodes.push({point,clearance:0,x:0,y:0,z:0,component:-1});if(nodes.length>=512)break;}
    }
    const components=[]; // Disconnected islands inside one GLB mesh each retain their own detail budget.
    for(let start=0;start<nodes.length;start++)if(nodes[start].component<0){const component=components.length,queue=[start];nodes[start].component=component;for(let i=0;i<queue.length;i++){const node=nodes[queue[i]];for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const next=lookup.get(key(node.x+dx,node.y+dy,node.z+dz));if(next!=null&&nodes[next].component<0){nodes[next].component=component;queue.push(next);}}}components.push(queue);}
    return {T,mesh,tree,inverse,minScale,size,physicalSize,step,dims,nodes,lookup,components,surfaceFallback,contains,nearestPoint,key,
      toLocal:world=>world.clone().applyMatrix4(inverse),toWorld:local=>local.clone().applyMatrix4(mesh.matrixWorld)};
  }
  function nearestNode(field,point,component=null){
    let best=0,distance=Infinity;for(let i=0;i<field.nodes.length;i++){const node=field.nodes[i];if(component!=null&&node.component!==component)continue;const d=node.point.distanceToSquared(point);if(d<distance){best=i;distance=d;}}return best;
  }
  function routeGrid(field,start,goal){
    if(start===goal)return [start];
    const nodes=field.nodes,previous=new Int32Array(nodes.length).fill(-1),cost=new Float64Array(nodes.length).fill(Infinity),open=[]; // A bounded binary heap avoids scanning the whole frontier for every route step.
    const push=(id,score)=>{let i=open.length;open.push({id,score});while(i){const parent=(i-1)>>>1;if(open[parent].score<=score)break;open[i]=open[parent];i=parent;}open[i]={id,score};};
    const pop=()=>{const first=open[0],last=open.pop();if(open.length){let i=0;while(i*2+1<open.length){let child=i*2+1;if(child+1<open.length&&open[child+1].score<open[child].score)child++;if(open[child].score>=last.score)break;open[i]=open[child];i=child;}open[i]=last;}return first.id;};
    cost[start]=0;push(start,0);
    while(open.length){const current=pop();if(current===goal)break;const node=nodes[current];for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
      const next=field.lookup.get(field.key(node.x+dx,node.y+dy,node.z+dz));if(next==null)continue;const distance=node.point.distanceTo(nodes[next].point),candidate=cost[current]+distance*(1+.03/Math.max(.002,nodes[next].clearance)); // Prefer roomier corridors while preserving narrow trim paths.
      if(candidate>=cost[next])continue;cost[next]=candidate;previous[next]=current;push(next,candidate+nodes[next].point.distanceTo(nodes[goal].point));
    }}
    if(previous[goal]<0)return [];
    const route=[goal];while(route[route.length-1]!==start)route.push(previous[route[route.length-1]]);return route.reverse();
  }
  function segmentInside(field,a,b){
    if(field.surfaceFallback)return true;
    const steps=Math.max(1,Math.ceil(a.distanceTo(b)/Math.max(1e-5,Math.min(field.step.x,field.step.y,field.step.z)*.7))); // Do not shortcut through holes or between disconnected islands.
    for(let i=1;i<steps;i++)if(!field.contains(a.clone().lerp(b,i/steps)))return false;return true;
  }
  function contactBetween(T,a,b,tolerance){
    const overlap=new T.Box3().copy(a.part.bounds).expandByScalar(tolerance).intersect(b.part.bounds.clone().expandByScalar(tolerance)),center=a.part.bounds.getCenter(new T.Vector3()).add(b.part.bounds.getCenter(new T.Vector3())).multiplyScalar(.5),candidates=[center]; // Broad-phase bounds nominate candidates; actual triangles decide contact.
    if(!overlap.isEmpty()){candidates.push(overlap.getCenter(new T.Vector3()));for(let x=0;x<3;x++)for(let y=0;y<3;y++)for(let z=0;z<3;z++)candidates.push(new T.Vector3(overlap.min.x+(overlap.max.x-overlap.min.x)*x/2,overlap.min.y+(overlap.max.y-overlap.min.y)*y/2,overlap.min.z+(overlap.max.z-overlap.min.z)*z/2));}
    for(const candidate of candidates){
      const pa=a.toLocal(candidate),pb=b.toLocal(candidate);if(a.contains(pa)&&b.contains(pb))return candidate;
      for(const [first,second] of [[a,b],[b,a]]){const point=first.toWorld(first.nearestPoint(first.toLocal(candidate)).point),local=second.toLocal(point),other=second.nearestPoint(local),world=second.toWorld(other.point);if(second.contains(local))return point;if(point.distanceTo(world)<=tolerance)return point.add(world).multiplyScalar(.5);}
    }
    return null;
  }
  function planPart(field,ports,recipe,random){
    const T=field.T,paths=[],axis=['x','y','z'].sort((a,b)=>field.physicalSize[b]-field.physicalSize[a]),slender=field.physicalSize[axis[0]]>field.physicalSize[axis[1]]*2.5&&field.physicalSize[axis[1]]<field.physicalSize[axis[2]]*2.5; // Broad plates receive planar knots; long thin rails retain a principal spine.
    if(field.surfaceFallback){
      const triangles=[];const collect=node=>{if(node.triangles)triangles.push(...node.triangles);else{collect(node.left);collect(node.right);}};collect(field.tree); // Open trim cannot provide a solid interior, so keep its roots on actual triangles.
      for(const triangle of triangles.slice(0,64))paths.push({points:[triangle.a.clone().lerp(triangle.b,.2),triangle.getMidpoint(new T.Vector3()),triangle.b.clone().lerp(triangle.c,.2)],kind:'detail',freeEnd:true,startTime:0,endTime:1});
      return {field,ports,paths,slender:true};
    }
    const addRoute=(ids,kind,freeEnd=false)=>{
      const points=ids.map(id=>field.nodes[id].point.clone());if(!points.length)return null;if(points.length===1)points.push(points[0].clone());
      const shortened=[points[0]];for(let i=0;i<points.length-1;){let next=Math.min(points.length-1,i+12);while(next>i+1&&!segmentInside(field,points[i],points[next]))next--;shortened.push(points[next]);i=next;}
      const path={points:shortened,kind,freeEnd,startTime:kind==='entry'?0:kind==='knot'?.38:.28,endTime:kind==='entry'?.38:1};paths.push(path);return path;
    };
    for(let component=0;component<field.components.length;component++){
      const ids=field.components[component],center=ids.reduce((sum,id)=>sum.add(field.nodes[id].point),new T.Vector3()).multiplyScalar(1/ids.length); // Every disconnected feature gets a hub and principal path.
      let hub=ids[0],score=-Infinity;for(const id of ids){const node=field.nodes[id],value=node.clearance-node.point.distanceTo(center)*.15;if(value>score){score=value;hub=id;}}
      const localPorts=ports.filter(port=>field.nodes[port.node].component===component),entry=localPorts.find(port=>port.entry); // Ground/parent entry fills before the piece forks into other neighbours.
      let low=ids[0],high=ids[0];for(const id of ids){if(field.nodes[id].point[axis[0]]<field.nodes[low].point[axis[0]])low=id;if(field.nodes[id].point[axis[0]]>field.nodes[high].point[axis[0]])high=id;}
      const entryNode=entry?.node??(field.part.grounded?ids.reduce((best,id)=>field.toWorld(field.nodes[id].point).y<field.toWorld(field.nodes[best].point).y?id:best,ids[0]):low);
      const entryPath=addRoute(routeGrid(field,entryNode,hub),'entry'); // Keep each route attached to its own component's entry.
      if(entry&&entryPath){entryPath.points.unshift(field.toLocal(entry.point));entryPath.startRadius=entry.radius;}
      for(const port of localPorts)if(port!==entry){const path=addRoute(routeGrid(field,hub,port.node),'fork');if(path){path.points.push(field.toLocal(port.point));path.endRadius=port.radius;}}
      for(const end of [low,high])if(end!==entryNode)addRoute(routeGrid(field,hub,end),'detail',true);
      const knots=slender?0:Math.min(8,Math.ceil(recipe.knotDensity*Math.max(.25,recipe.targetDensity/3))); // Knot density scales winding independently of the surface-detail budget.
      for(let knot=0;knot<knots;knot++){
        const route=[hub],turns=12+Math.round(recipe.detailPreservation*12),phase=random()*Math.PI*2;let previous=hub; // Closed routes return to the hub instead of leaving cut ends in the large piece.
        for(let step=0;step<=turns;step++){
          const angle=phase+step/turns*Math.PI*2,desired=center.clone(),factor=.18+.25*(knot+1)/Math.max(1,knots); // Nested, slightly warped loops occupy the real interior.
          desired[axis[0]]+=Math.cos(angle)*field.size[axis[0]]*factor;desired[axis[1]]+=Math.sin(angle)*field.size[axis[1]]*factor;desired[axis[2]]+=Math.sin(angle*2+phase)*field.size[axis[2]]*.18;
          const next=nearestNode(field,desired,component),section=routeGrid(field,previous,next);route.push(...section.slice(1));previous=next;
        }
        route.push(...routeGrid(field,previous,hub).slice(1));addRoute(route,'knot');
      }
    }
    if(!paths.length&&field.nodes.length){const center=field.nodes[0].point,delta=new T.Vector3(Math.max(.002,field.size.x*.15),0,0);paths.push({points:[center.clone().sub(delta),center.clone().add(delta)],kind:'detail',freeEnd:true,startTime:0,endTime:1});} // Tiny/open details still receive a visible path.
    return {field,ports,paths,slender};
  }
  function* plan(T,target,parts,recipe){
    target.updateWorldMatrix(true,true); // Account for the imported group's placement before building local-to-world contact fields.
    const fields=[]; // Each field and all path calculations are instance-local CPU data.
    for(const part of parts){const field=makeField(T,part.mesh,recipe.detailPreservation);field.part=part;fields.push(field);yield {part:'Map '+part.label,layer:fields.length,layers:parts.length};}
    const contacts=[],ports=parts.map(()=>[]),tolerance=Math.max(.006,recipe.minRootRadius); // Exact touching faces and tiny authored rounding gaps count as adjacency.
    for(let a=0;a<parts.length;a++)for(let b=a+1;b<parts.length;b++){
      const expanded=parts[a].bounds.clone().expandByScalar(tolerance);if(!expanded.intersectsBox(parts[b].bounds))continue;
      const point=contactBetween(T,fields[a],fields[b],tolerance);if(!point)continue;
      const nodeA=nearestNode(fields[a],fields[a].toLocal(point)),nodeB=nearestNode(fields[b],fields[b].toLocal(point)),radius=Math.min(recipe.minRootRadius,fields[a].nodes[nodeA].clearance*fields[a].minScale*.7,fields[b].nodes[nodeB].clearance*fields[b].minScale*.7); // Both sides use the same neck radius at the actual contact.
      const edge={a,b,point};contacts.push(edge);for(const [index,other,node] of [[a,b,nodeA],[b,a,nodeB]])ports[index].push({other,point:point.clone(),node,entry:false,radius});
    }
    const reached=new Set(parts.filter(part=>part.grounded).map(part=>part.index)); // Retain the original grounded pieces, then traverse every real adjacency before considering gaps.
    for(const index of reached){parts[index].parent=null;parts[index].depth=0;}
    while(reached.size<parts.length){let changed=false;for(const edge of contacts)for(const [parent,child] of [[edge.a,edge.b],[edge.b,edge.a]])if(reached.has(parent)&&!reached.has(child)){parts[child].parent=parent;parts[child].depth=parts[parent].depth+1;parts[child].linkGap=0;reached.add(child);changed=true;}if(changed)continue;
      let best=null;for(const parent of reached)for(const child of parts)if(!reached.has(child.index)){const distance=parts[parent].bounds.getCenter(new T.Vector3()).distanceTo(child.bounds.getCenter(new T.Vector3()));if(!best||distance<best.distance)best={parent,child,distance};}if(!best)break;best.child.parent=best.parent;best.child.depth=parts[best.parent].depth+1;best.child.linkGap=best.distance;reached.add(best.child.index);
    }
    const networks=[]; // A dedicated seeded path budget for every piece preserves small ornaments.
    for(let i=0;i<parts.length;i++){for(const port of ports[i])port.entry=port.other===parts[i].parent;networks.push(planPart(fields[i],ports[i],recipe,randomFor(recipe.seed+':network:'+i)));yield {part:'Route '+parts[i].label,layer:i+1,layers:parts.length};}
    return {fields,contacts,parts:networks,diagnostics:{mode:'connected-volume',contactCount:contacts.length,junctions:ports.filter(list=>list.length>2).length,components:fields.reduce((n,field)=>n+field.components.length,0),openGuides:fields.filter(field=>field.surfaceFallback).length,paths:networks.reduce((n,network)=>n+network.paths.length,0),knots:networks.reduce((n,network)=>n+network.paths.filter(path=>path.kind==='knot').length,0),pieces:networks.map((network,i)=>({label:parts[i].label,neighbours:ports[i].length,paths:network.paths.length,slender:network.slender,nodes:fields[i].nodes.length}))}};
  }
  function buildGeometry(T,network,target,recipe){
    const field=network.field,targetInverse=new T.Matrix4().copy(target.matrixWorld).invert(),positions=[],uvs=[],indices=[],strands=[]; // Final meshes are target-local, matching existing foliage ownership and animation.
    const targetScale=new T.Vector3().setFromMatrixScale(target.matrixWorld),radiusScale=1/Math.max(1e-6,targetScale.x,targetScale.y,targetScale.z); // Keep physical thickness bounded when the imported root group itself is scaled.
    let minRadius=Infinity,maxRadius=0,outsideSamples=0; // On-device evidence of local thinning and guide-constrained paths.
    for(const path of network.paths){
      const dense=[]; // Resample the safe route, then round corners only while both adjacent segments remain inside the original mesh.
      for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i],steps=Math.max(1,Math.ceil(a.distanceTo(b)/Math.max(.01,.07/field.minScale)));for(let step=i===1?0:1;step<=steps;step++)dense.push(a.clone().lerp(b,step/steps));}
      if(dense.length<2)continue;
      for(let pass=0;pass<2;pass++)for(let i=1;i<dense.length-1;i++){const candidate=dense[i].clone().multiplyScalar(.6).addScaledVector(dense[i-1],.2).addScaledVector(dense[i+1],.2);if(field.contains(candidate)&&segmentInside(field,dense[i-1],candidate)&&segmentInside(field,candidate,dense[i+1]))dense[i]=candidate;}
      const points=dense.map(point=>field.toWorld(point).applyMatrix4(targetInverse)),lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+points[i].distanceTo(points[i-1])); // Arc-length sampling gives constant physical growth speed through bends.
      const length=lengths[lengths.length-1];if(length<1e-6)continue;
      const curve=new T.Curve();curve.getPoint=curve.getPointAt=(t,out=new T.Vector3())=>{const distance=t*length;let lo=1,hi=lengths.length-1;while(lo<hi){const mid=(lo+hi)>>>1;if(lengths[mid]<distance)lo=mid+1;else hi=mid;}return out.copy(points[lo-1]).lerp(points[lo],(distance-lengths[lo-1])/Math.max(1e-9,lengths[lo]-lengths[lo-1]));};curve.getTangentAt=(t,out=new T.Vector3())=>out.copy(curve.getPointAt(Math.min(1,t+.0001))).sub(curve.getPointAt(Math.max(0,t-.0001))).normalize();
      const segments=clamp(Math.ceil(length/.055),12,192),tube=new T.TubeGeometry(curve,segments,1,5,false),attribute=tube.getAttribute('position'),vertexStart=positions.length/3,indexStart=indices.length; // Tube frames follow the computed piece route; one merged draw call per piece is retained.
      const requested=Math.max(recipe.minRootRadius,recipe.radius*(path.kind==='detail'?.55:Math.min(2,1+recipe.knotDensity*.25))),worldToLocal=new T.Matrix4().copy(field.inverse).multiply(target.matrixWorld); // Thick pieces can regain width after narrow connections.
      for(let ring=0;ring<=segments;ring++){
        const t=ring/segments,center=curve.getPointAt(t),local=center.clone().applyMatrix4(worldToLocal),inside=field.contains(local),clearance=field.nearestPoint(local).distance*field.minScale; // Radius follows actual surface distance, not the part's bounding dimensions.
        if(!inside&&!field.surfaceFallback&&t>.001&&t<.999)outsideSamples++;
        let radius=field.surfaceFallback?Math.min(requested,.004):Math.min(requested,clearance*.72); // Safety takes precedence over the preferred minimum on exceptionally thin details.
        if(path.startRadius!=null&&t<.1)radius=Math.max(radius,path.startRadius*(1-t/.1));
        if(path.endRadius!=null&&t>.9)radius=Math.max(radius,path.endRadius*(t-.9)/.1); // Matching contact ports meet with a shared, momentarily narrow neck.
        if(path.freeEnd)radius*=Math.min(1,(1-t)/.08);if(t>.05&&t<.95)minRadius=Math.min(minRadius,radius);maxRadius=Math.max(maxRadius,radius);
        for(let spoke=0;spoke<6;spoke++){const index=ring*6+spoke;positions.push(center.x+(attribute.getX(index)-center.x)*radius*radiusScale,center.y+(attribute.getY(index)-center.y)*radius*radiusScale,center.z+(attribute.getZ(index)-center.z)*radius*radiusScale);uvs.push(spoke/5,t);}
      }
      for(const index of tube.index.array)indices.push(index+vertexStart);tube.dispose();strands.push({vertexStart,indexStart,kind:path.kind,radial:5,ringCount:segments+1,startTime:path.startTime,endTime:path.endTime});
    }
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
    return {geometry,strands,diagnostics:{minRadius:Number.isFinite(minRadius)?minRadius:0,maxRadius,outsideSamples}};
  }
  root.LiveRootNetwork={plan,buildGeometry,routeGrid};
})(typeof window!=='undefined'?window:globalThis);
