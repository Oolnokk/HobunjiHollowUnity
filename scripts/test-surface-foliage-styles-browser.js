'use strict';
// Browser regression uses the shipped Three.js r128, actual growth code and
// the shared authoring panel. No mock geometry or source-text-only assertions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
let chromium; // Playwright runs the actual DOM, materials and BufferGeometry.
try { ({chromium}=require('playwright')); }
catch(error) {
  if(error.code!=='MODULE_NOT_FOUND')throw error;
  console.log('skip: playwright not installed (browser-only smoke test)');
  process.exit(0);
}
const root=path.resolve(__dirname,'..'); // Checked-in browser scripts are served without a deployment.
const localThree=path.join(root,'node_modules/three/build/three.min.js'); // CI installs pinned Three.js locally; no unreliable CDN request.
const server=http.createServer((request,response)=>{
  const route=(request.url||'/').split('?')[0];
  if(route==='/test-page'){
    response.setHeader('Content-Type','text/html');
    response.end('<!doctype html><html><head><script src="'+(fs.existsSync(localThree)?'/vendor-three.js':'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js')+'"></script><script src="/docs/js/foliage-generator.js"></script><script src="/docs/js/HousePieceGen.js"></script><script src="/docs/js/surface-foliage-authoring.js"></script></head><body><div id="controls"></div></body></html>');
    return;
  }
  if(route==='/vendor-three.js'){
    fs.readFile(localThree,(err,bytes)=>{
      if(err){response.writeHead(404);response.end(err.message);return;}
      response.setHeader('Content-Type','text/javascript');response.end(bytes);
    });return;
  }
  const file=path.resolve(root,decodeURIComponent(route).replace(/^\/+/,''));
  if(!file.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
  fs.readFile(file,(err,bytes)=>{
    if(err){response.writeHead(404);response.end(err.message);return;}
    response.setHeader('Content-Type','text/javascript');response.end(bytes);
  });
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser; // Browser is closed in finally even when an assertion fails.
  try {
    browser=await chromium.launch({args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage();
    const pageErrors=[]; // Captures browser exceptions for CI and mobile-only debugging.
    page.on('pageerror',error=>pageErrors.push(error.stack||error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/test-page',{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>!!(window.THREE?.BoxGeometry&&window.FoliageGenerator?.buildSurfaceGrowth&&window.SurfaceFoliageAuthoring?.mount&&window.HousePieceGen?.buildGroupFromPiece),null,{timeout:30000});
    const data=await page.evaluate(async()=>{
      const T=window.THREE,growth=window.FoliageGenerator; // Actual production THREE and generator.
      function build(geometry,style,density,count=12){ // Consistent authored wall test with no helper meshes.
        const root=new T.Group(),mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({color:0xffffff}));
        mesh.userData.surfaceFoliageRole='walls';root.add(mesh);
        return growth.buildSurfaceGrowth(root,{style,density,count,kind:'roots',target:'walls',seed:'corner-wrap-browser',
          radius:.05,length:2,offset:.01,texture:''});
      }
      const flat=build(new T.PlaneGeometry(2,2),'cornerFill',.5,7);
      const corners=build(new T.BoxGeometry(4,3,2),'cornerFill',.5,7);
      const low=build(new T.BoxGeometry(4,3,2),'wrap',.1,80);
      const sameDensityDifferentCount=build(new T.BoxGeometry(4,3,2),'wrap',.1,1);
      const shortWrap=build(new T.BoxGeometry(4,3,2),'wrap',.9,24);

      const high=build(new T.BoxGeometry(4,3,2),'wrap',.9,1);
      const full=build(new T.BoxGeometry(4,3,2),'wrap',1,24);
      const partial=build(new T.BoxGeometry(4,3,2),'wrap',.95,24);
      const reused=build(new T.BoxGeometry(4,3,2),'wrap',1,24);
      const edgeBound=build(new T.PlaneGeometry(4,4),'wrap',1,16);
      const edgePairs=edgeBound.userData.surfaceGrowthEndpoints||[];
      const allEndpoints=edgePairs.flatMap(pair=>[pair.start,pair.end]);
      const endpointSeparation=Math.min(...allEndpoints.flatMap((point,i)=>
        allEndpoints.slice(i+1).map(other=>Math.hypot(point[0]-other[0],point[1]-other[1],point[2]-other[2]))));
      const correctEdges=edgePairs.every(pair=>pair.startEdge!==pair.endEdge&&
        [pair.start,pair.end].every(p=>(Math.abs(Math.abs(p[0])-2)<.0001||Math.abs(Math.abs(p[1])-2)<.0001)&&Math.abs(p[2])<.0001));

      const count=group=>group.children.filter(x=>x.isMesh&&!x.userData.surfaceGrowthCover)
        .reduce((sum,x)=>sum+x.geometry.attributes.position.count,0);
      const cover=group=>group.children.filter(x=>x.userData.surfaceGrowthCover);
      const digest=group=>group.children.map(x=>{
        const v=x.geometry.attributes.position.array;
        return Array.from(v.slice(0,Math.min(v.length,40))).map(x=>x.toFixed(5)).join(',');
      }).join('|');
      const segmentGeometry=new T.BufferGeometry(); // Independent wall planes slightly separated at their common corner.
      segmentGeometry.setAttribute('position',new T.Float32BufferAttribute([
        .02,0,0,2,0,0,.02,2,0,2,0,0,2,2,0,.02,2,0,
        0,0,.03,0,2,.03,0,0,2,0,2,.03,0,2,2,0,0,2
      ],3));
      const split=build(segmentGeometry,'cornerFill',.5,7);
      // Two perpendicular *authored planes* share a vertical structural edge.
      // Read tube-ring centroids to test the actual spline, not only the presence
      // of a mesh. The five unique ring vertices (sixth is a UV seam duplicate)
      // cancel the tube radius so their average approximates the spine.
      const edgeFaces=[[0,0,0],[0,2,0],[0,2,2],[0,0,0],[0,2,2],[0,0,2],
        [0,0,0],[2,0,0],[2,2,0],[0,0,0],[2,2,0],[0,2,0]];
      function edgeSpline(curl,renderLift=0,clearance=0){
        const root=new T.Group();
        growth.replaceSemanticSurfaceGuides(root,[{id:'architectural-corner',role:'walls',vertices:edgeFaces,renderLift}]);
        const generated=growth.buildSurfaceGrowth(root,{
          style:'cornerFill',kind:'roots',target:'walls',radius:.05,
          offset:clearance,count:1,length:1.85,seed:'tight-edge-spline',curl,texture:''
        });
        const position=generated.children[0].geometry.getAttribute('position'),centers=[];
        for(let i=0;i<position.count;i+=6){
          const center=new T.Vector3();
          for(let j=0;j<5;j++)center.add(new T.Vector3().fromBufferAttribute(position,i+j));
          centers.push(center.multiplyScalar(1/5));
        }
        return {
          rings:centers.length,
          maxDeviation:Math.max(...centers.map(p=>Math.hypot(p.x-renderLift-clearance,p.z-renderLift-clearance))),
          endDeviation:Math.max(Math.hypot(centers[0].x-renderLift-clearance,centers[0].z-renderLift-clearance),
            Math.hypot(centers[centers.length-1].x-renderLift-clearance,centers[centers.length-1].z-renderLift-clearance))
        };
      }
      const rawEdgeSpline=edgeSpline(0),curledEdgeSpline=edgeSpline(2),cladEdgeSpline=edgeSpline(0,.26),clearanceEdgeSpline=edgeSpline(0,0,.02);
      // Slightly separated planes must snap to the real intersection of their
      // infinite wall planes. The old implementation tracked (x=.02,z=0)
      // rather than the actual intersection (x=.02,z=.03).
      const quad=q=>[q[0],q[1],q[2],q[0],q[2],q[3]];
      const wallA=quad([[0,0,0],[0,4,0],[0,4,3],[0,0,3]]);
      const wallB=quad([[0,0,0],[3,0,0],[3,4,0],[0,4,0]]);
      const shortB=quad([[0,0,0],[3,0,0],[3,2,0],[0,2,0]]);
      const upperB=quad([[0,2,0],[3,2,0],[3,4,0],[0,4,0]]);
      const gapA=quad([[.02,0,0],[.02,4,0],[.02,4,3],[.02,0,3]]);
      const gapB=quad([[0,0,.03],[3,0,.03],[3,4,.03],[0,4,.03]]);
      function inspectCornerSegments(vertices,seed){
        const root=new T.Group();
        growth.replaceSemanticSurfaceGuides(root,[{role:'walls',id:'test-wall',vertices}]);
        const result=growth.buildSurfaceGrowth(root,{style:'cornerFill',kind:'roots',target:'walls',
          count:1,length:3.8,seed:'segmented-'+seed,radius:.05,curl:0,offset:0,texture:''});
        const pos=result.children[0]?.geometry.getAttribute('position'),centers=[];
        if(pos)for(let i=0;i<pos.count;i+=6){
          const center=new T.Vector3();
          for(let j=0;j<5;j++)center.add(new T.Vector3().fromBufferAttribute(pos,i+j));
          centers.push(center.multiplyScalar(.2));
        }
        return {
          maxY:centers.length?Math.max(...centers.map(x=>x.y)):0,
          minY:centers.length?Math.min(...centers.map(x=>x.y)):0,
          maxGapError:centers.length?Math.max(...centers.map(x=>Math.hypot(x.x-.02,x.z-.03))):100,
          corners:result.userData.surfaceGrowthStats.guideCorners
        };
      }
      const gappedIntersection=inspectCornerSegments([...gapA,...gapB],0);
      const partialCorner=Array.from({length:8},(_,i)=>inspectCornerSegments([...wallA,...shortB],i));
      const splitCorner=Array.from({length:12},(_,i)=>inspectCornerSegments([...wallA,...shortB,...upperB],i));

      // Furniture-style architectural surface recognition, including long-wall
      // T-junctions to subdivided gables and real angle/disconnection breaks.
      const archQuad=vertices=>[vertices[0],vertices[1],vertices[2],vertices[0],vertices[2],vertices[3]];
      const baseWall=archQuad([[0,0,0],[4,0,0],[4,2,0],[0,2,0]]);
      const oneGable=[[0,2,0],[4,2,0],[2,3,0]];
      const splitGable=[[0,2,0],[2,2,0],[2,3,0],[2,2,0],[4,2,0],[2,3,0]];
      const angledGable=[[0,2,0],[4,2,0],[2,3,.5]]; // ~26.6°: above default 24°, below adjustable 35°.
      const floatingGable=[[0,3,0],[4,3,0],[2,4,0]];
      function recognitionReport(vertices){
        const root=new T.Group();
        const regions=growth.recognizeArchitecturalSurfaceRegions(root,[{vertices,role:'walls',renderLift:.26}]);
        growth.replaceSemanticSurfaceGuides(root,regions);
        const outlines=growth.buildSurfaceGrowth(root,{style:'cornerFill',kind:'roots',target:'walls',
          seed:'surface-region-test',radius:.05,length:2,count:8,offset:0,curl:0,texture:''});
        const coverage=growth.buildSurfaceGrowth(root,{style:'wrap',kind:'vines',target:'walls',
          seed:'surface-region-test',radius:.05,length:2,count:8,offset:0,texture:''});
        return {regions:regions.length,triangles:regions.map(region=>region.vertices.length/3),
          outlines:count(outlines),outerEdges:outlines.userData.surfaceGrowthStats.guideBoundaries,
          coverFaces:coverage.userData.surfaceGrowthStats.triangles};
      }
      const coplanarGable=recognitionReport([...baseWall,...oneGable]);
      const tessellatedGable=recognitionReport([...baseWall,...splitGable]);
      const steepGable=recognitionReport([...baseWall,...angledGable]);
      const disconnectedGable=recognitionReport([...baseWall,...floatingGable]);
      const transformedGable=(function(){
        const root=new T.Group();root.position.set(8,2,-4);
        const geometry=new T.BufferGeometry();
        geometry.setAttribute('position',new T.Float32BufferAttribute(oneGable.flat(),3));
        geometry.setIndex([0,1,2]); // InteriorCeilings' gable backing may be indexed.
        const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial());root.add(mesh);
        const regions=growth.recognizeArchitecturalSurfaceRegions(root,[
          {vertices:baseWall,role:'walls'},{sourceMesh:mesh,faceIndices:[0],role:'walls'}]);
        return {regions:regions.length,triangles:regions.reduce((sum,reg)=>sum+reg.vertices.length/3,0)};
      })();
      const furnitureStyleAngle=(function(){
        const root=new T.Group(),source=[{role:'walls',vertices:[...baseWall,...angledGable]}];
        return {narrow:growth.recognizeArchitecturalSurfaceRegions(root,source,{splitAngleDeg:10}).length,
          wide:growth.recognizeArchitecturalSurfaceRegions(root,source,{splitAngleDeg:35}).length};
      })();
      // Build an actual HousePieceGen house with plenty of decorative brick triangles:
      // Corner Fill and Wrap must see only the TWO original sheer wall quads.
      const houseFaces=[
        {id:'wall-a',tag:'wall',v:[[0,0,0],[0,2,0],[0,2,3],[0,0,3]]},
        {id:'wall-b',tag:'wall',v:[[0,0,0],[3,0,0],[3,2,0],[0,2,0]]}
      ];
      const housePiece={id:'semantic-house',gridSize:2,footprint:{cells:[{x:0,y:0}]},
        base:{faces:houseFaces},surfaceGrowth:[]};
      const brickMaker={build(){
        const group=new T.Group();
        for(let i=0;i<8;i++)group.add(new T.Mesh(new T.BoxGeometry(.4,.4,.4),new T.MeshBasicMaterial()));
        return group;
      }};
      const runHouse=style=>{
        housePiece.surfaceGrowth=[{style,kind:'roots',count:7,length:2,target:'walls',seed:'semantic-house',texture:''}];
        const group=window.HousePieceGen.buildGroupFromPiece(T,housePiece,0,0,{wallBuilder:brickMaker});
        const guides=[],growth=[];
        group.traverse(node=>{
          if(node.userData?.surfaceFoliageGuide)guides.push(node);
          if(node.userData?.surfaceFoliage)growth.push(node);
        });
        return {guides:guides.length,renderLift:guides[0]?.userData.surfaceFoliageRenderLift||0,
          guideHidden:guides.every(node=>node.visible===false&&node.layers.mask===(1<<30)),
          sourceTriangles:growth[0].userData.surfaceGrowthStats.triangles,
          tubes:count(growth[0]),sceneNodes:guides.length};
      };
      const houseNatural=runHouse('natural'),houseCorners=runHouse('cornerFill'),houseWrap=runHouse('wrap');

      // Use the real cross-gabled temple instead of only synthetic boxes.
      // The authored entry has dozens of internal thickness faces and its
      // primary/cross-gable volumes deliberately intersect.
      const temple=await (await fetch('/docs/config/pieces/temple.json')).json();
      const templeSources=growth.architecturalSurfaceSources(temple.base.faces,{wallLift:.26,roofLift:.16});
      const templeRegions=growth.recognizeArchitecturalSurfaceRegions(new T.Group(),templeSources,
        {occlusionFaces:temple.base.faces});
      const templeWrapHost=new T.Group();
      growth.replaceSemanticSurfaceGuides(templeWrapHost,templeRegions);
      const templeWrap=growth.buildSurfaceGrowth(templeWrapHost,{kind:'vines',style:'wrap',
        target:'walls',count:4,strandLimit:4,perSurface:true,length:12,
        radius:.1,offset:.008,curl:.4,density:.45,texture:'',seed:'temple-real-wrap-check'});
      const templeWrapStats=templeWrap.userData.surfaceGrowthStats;
      const templeWrapDetails=templeWrap.userData.surfaceGrowthSurfaces;

      const surfaceArea=vertices=>{
        let area=0;
        for(let i=0;i+2<vertices.length;i+=3){
          const a=new T.Vector3(...vertices[i]),b=new T.Vector3(...vertices[i+1]),c=new T.Vector3(...vertices[i+2]);
          area+=b.sub(a).cross(c.sub(a)).length()/2;
        }
        return area;
      };

      // Interior gable backings sometimes overlap a coplanar authored wall.
      // Their common area is NOT two separate exposed surfaces.
      const interiorOverlapRoot=new T.Group();
      const coverSources=[
        {role:'walls',id:'long-wall',vertices:[[0,0,0],[2,0,0],[2,2,0],[0,0,0],[2,2,0],[0,2,0]]},
        {role:'walls',id:'gable-backing',vertices:[[1,0,0],[3,0,0],[3,2,0],[1,0,0],[3,2,0],[1,2,0]]}
      ];
      const noClipping=growth.recognizeArchitecturalSurfaceRegions(interiorOverlapRoot,coverSources);
      const clippedBacking=growth.recognizeArchitecturalSurfaceRegions(interiorOverlapRoot,coverSources,{clipCoplanarOverlaps:true});
      const interiorAreaBefore=noClipping.reduce((sum,r)=>sum+surfaceArea(r.vertices),0);
      const interiorAreaAfter=clippedBacking.reduce((sum,r)=>sum+surfaceArea(r.vertices),0);
      const templeSourceArea=templeSources.reduce((sum,src)=>sum+surfaceArea(src.vertices),0);
      const templeExposedArea=templeRegions.reduce((sum,region)=>sum+surfaceArea(region.vertices),0);
      const templeSourceCount=templeSources.length,templeRegionCount=templeRegions.length;
      const templeVisibleRoles=templeRegions.reduce((counts,region)=>(counts[region.role]=(counts[region.role]||0)+1,counts),{});
      // Two disconnected recognized wall surfaces must EACH receive the count,
      // independently capped by strandLimit. Natural opts in explicitly.
      const regionParent=new T.Group(),separated=[
        {role:'walls',id:'left',recognizedSurface:true,vertices:[[0,0,0],[0,2,0],[0,2,2],[0,0,0],[0,2,2],[0,0,2]]},
        {role:'walls',id:'right',recognizedSurface:true,vertices:[[5,0,0],[5,2,0],[5,2,2],[5,0,0],[5,2,2],[5,0,2]]}
      ];
      growth.replaceSemanticSurfaceGuides(regionParent,separated);
      const perSurfaceCorners=growth.buildSurfaceGrowth(regionParent,{kind:'roots',style:'cornerFill',
        target:'walls',count:5,strandLimit:3,length:1.8,radius:.04,seed:'per-surface-corners',texture:''});
      const perSurfaceNatural=growth.buildSurfaceGrowth(regionParent,{kind:'vines',style:'natural',perSurface:true,
        target:'walls',count:4,strandLimit:2,length:1.8,radius:.04,seed:'per-surface-vines',texture:''});
      const budgetCorners=perSurfaceCorners.userData.surfaceGrowthStats;
      const budgetNatural=perSurfaceNatural.userData.surfaceGrowthStats;
      const perSurfaceDetails=perSurfaceCorners.userData.surfaceGrowthSurfaces;

      // Real exposed geometry, not only flags: a second wing's wall enters
      // the first wing's enclosed volume. Only the exposed half may become a
      // candidate surface or outline.
      const exposedRoot=new T.Group();
      const face=(id,tag,v,section,extra={})=>({id,tag,v,highlandSectionRole:section,...extra});
      const solids=[
        face(1,'floor',[[0,0,0],[2,0,0],[2,0,2],[0,0,2]],'main',{highlandFrustumBottom:true}),
        face(2,'ceiling',[[0,1,0],[2,1,0],[2,1,2],[0,1,2]],'main',{highlandFrustumTop:true}),
        face(3,'roof',[[0,2,0],[2,2,0],[2,2,2],[0,2,2]],'main'),
        face(4,'wall',[[1,0,.5],[3,0,.5],[3,1,.5],[1,1,.5]],'wing'),
        face(5,'wall',[[1,0,.5],[1,1,.5],[1,1,1.5],[1,0,1.5]],'wing',{seamCap:true})
      ];
      const visible=growth.recognizeArchitecturalSurfaceRegions(exposedRoot,
        growth.architecturalSurfaceSources(solids,{wallLift:0,roofLift:0}),{occlusionFaces:solids});
      const visibleWall=visible.filter(r=>r.role==='walls');
      const visibleCentroids=visibleWall.flatMap(r=>{
        const pts=r.vertices,centers=[];
        for(let i=0;i+2<pts.length;i+=3)centers.push((pts[i][0]+pts[i+1][0]+pts[i+2][0])/3);
        return centers;
      });


      // The named regions from Furniture Author (face-index subsets and labels)
      // replace the entire visible box mesh as the guide, including selected-part targeting.
      const furniture=new T.Group(),part=new T.Mesh(new T.BoxGeometry(2,1,1),new T.MeshBasicMaterial());
      part.userData.authoredPartId='test-chair';furniture.add(part);
      const namedCount=growth.replaceSemanticSurfaceGuides(furniture,[
        {sourceMesh:part,faceIndices:[0,1],partId:'test-chair',id:'test-chair:surface:0',label:'Right side',role:'furniture'},
        {sourceMesh:part,faceIndices:[2,3],partId:'test-chair',id:'test-chair:surface:2',label:'Left side',role:'furniture'}
      ]);
      const furnitureWrap=growth.buildSurfaceGrowth(furniture,{style:'wrap',kind:'vines',target:'selected',
        targetIds:['test-chair'],seed:'furniture-named',density:.5,length:2,texture:''});
      const furnitureNatural=growth.buildSurfaceGrowth(furniture,{style:'natural',kind:'vines',target:'selected',
        targetIds:['test-chair'],seed:'furniture-named',length:2,texture:''});
      const namedGuideTriangles=furnitureWrap.userData.surfaceGrowthStats.triangles;
      const rawFurnitureTriangles=furnitureNatural.userData.surfaceGrowthStats.triangles;
      const guidesInvisible=part.children.filter(child=>child.userData.surfaceFoliageGuide)
        .every(child=>!child.visible&&child.layers.mask===(1<<30));
      const removed=growth.replaceSemanticSurfaceGuides(furniture,[]);
      const afterClear=part.children.filter(child=>child.userData.surfaceFoliageGuide).length;
      const outer=new T.Group(),inner=new T.Group();outer.add(inner);
      const shell=new T.Mesh(new T.BoxGeometry(2,2,2),new T.MeshBasicMaterial()),nested=new T.Mesh(new T.BoxGeometry(.5,.5,.5),new T.MeshBasicMaterial());
      shell.userData.authoredPartId='outer';nested.userData.authoredPartId='inner';outer.add(shell);inner.add(nested);
      growth.replaceSemanticSurfaceGuides(inner,[{sourceMesh:nested,faceIndices:[0,1],id:'inner-side',partId:'inner',role:'furniture'}]);
      growth.replaceSemanticSurfaceGuides(outer,[{sourceMesh:shell,faceIndices:[0,1],id:'outer-side',partId:'outer',role:'furniture'}]);
      const outerGrowth=growth.buildSurfaceGrowth(outer,{style:'wrap',target:'selected',targetIds:['outer'],texture:'',count:3});
      const nestedSurvives=nested.children.filter(node=>node.userData.surfaceFoliageGuide).length;
      const outerTriangles=outerGrowth.userData.surfaceGrowthStats.triangles;
      growth.replaceSemanticSurfaceGuides(outer,[]);
      const nestedAfterCleanup=nested.children.filter(node=>node.userData.surfaceFoliageGuide).length;

      // Window-like entrance mode must cut the foliage guide even if the
      // broad wall triangles have NO vertices inside the opening rectangle.
      const entranceWall={id:1,tag:'wall',highlandSectionRole:'main',
        v:[[0,0,.5],[3,0,.5],[3,3,.5],[0,3,.5]]};
      const entranceFloor={tag:'entryTunnel',extensionFace:'floor',sourceTile:{x:1,y:1},
        v:[[1,0,0],[2,0,0],[2,0,1],[1,0,1]]};
      const entranceCeiling={tag:'entryTunnel',extensionFace:'ceiling',sourceTile:{x:1,y:1},
        v:[[1,1.5,0],[2,1.5,0],[2,1.5,1],[1,1.5,1]]};
      const entranceFaces=[entranceWall,entranceFloor,entranceCeiling];
      const regularPanels=growth.architecturalSurfaceSources(entranceFaces);
      const openingPanels=growth.architecturalSurfaceSources(entranceFaces,{tunnelAsOpening:true});
      const openingRegions=growth.recognizeArchitecturalSurfaceRegions(new T.Group(),openingPanels,{
        occlusionFaces:entranceFaces,tunnelAsOpening:true});
      let openingCentroidsInside=0,openingTriangleCount=0;
      for(const region of openingRegions)for(let i=0;i<region.vertices.length;i+=3){
        const center=region.vertices.slice(i,i+3).reduce((a,v)=>[a[0]+v[0]/3,a[1]+v[1]/3,a[2]+v[2]/3],[0,0,0]);
        openingTriangleCount++;
        if(center[0]>1.001&&center[0]<1.999&&center[1]>0&&center[1]<1.5)openingCentroidsInside++;
      }
      const shrinkRoot=new T.Group(),brickLayer=new T.Group();
      const brick=new T.Mesh(new T.BoxGeometry(5,3,.22),new T.MeshBasicMaterial({side:T.DoubleSide}));
      brick.position.z=.15;brickLayer.userData.isWallBricks=true;brickLayer.add(brick);shrinkRoot.add(brickLayer);
      const shrinkGuide=growth.recognizeArchitecturalSurfaceRegions(shrinkRoot,[{
        role:'walls',vertices:archQuad([[-2,0,0],[2,0,0],[2,3,0],[-2,3,0]])}]);
      growth.replaceSemanticSurfaceGuides(shrinkRoot,shrinkGuide);
      const shrinkRecipe={style:'natural',perSurface:true,kind:'vines',seed:'shrinkcheck',target:'walls',
        count:4,radius:.025,length:2,offset:.008,inset:0,curl:0,texture:''};
      const unshrunk=growth.buildSurfaceGrowth(shrinkRoot,shrinkRecipe);
      const shrunk=growth.buildSurfaceGrowth(shrinkRoot,{...shrinkRecipe,shrinkwrapFinal:true});
      const insetSample=growth.buildSurfaceGrowth(shrinkRoot,{...shrinkRecipe,inset:.025});
      const ringZ=group=>{
        const pos=group.children[0].geometry.getAttribute('position'),z=[];
        for(let i=0;i<pos.count;i+=6){
          let center=0;for(let j=0;j<5;j++)center+=pos.getZ(i+j)/5;
          z.push(center);
        }
        return {max:Math.max(...z),avg:z.reduce((a,b)=>a+b,0)/z.length};
      };
      const shrinkRawZ=ringZ(unshrunk),shrinkFinalZ=ringZ(shrunk),insetZ=ringZ(insetSample);

      let recipes=[]; // Mimics every editor's read/write adapter to verify actual UI serialization.
      window.SurfaceFoliageAuthoring.mount(document.getElementById('controls'),{
        targets:[['all','All walls']],read:()=>recipes,selectedIds:()=>[],
        write:next=>{recipes=next;return 'regenerated';}
      });
      const field=name=>document.querySelector('[data-field="'+name+'"]');
      const densityRow=document.querySelector('[data-wrap-controls]');
      const hiddenBefore=getComputedStyle(densityRow).display==='none';
      field('style').value='wrap';field('style').dispatchEvent(new Event('change'));
      const visibleAfter=getComputedStyle(densityRow).display!=='none';
      const budgetLabel=document.querySelector('[data-count-label]').textContent;
      const countHidden=getComputedStyle(document.querySelector('[data-count-control]')).display==='none';
      const paletteChoices=document.querySelector('[data-field="palette"]').options.length;
      const signInsetField=!!document.querySelector('[data-field="inset"][min="-0.5"]');
      const shrinkwrapField=!!document.querySelector('[data-field="shrinkwrapFinal"]');
      const entranceField=!!document.querySelector('[data-field="tunnelAsOpening"]');
      field('density').value='.75';field('count').value='9';field('strandLimit').value='4';field('perSurface').checked=true;
      document.querySelector('[data-action="apply"]').click();
      field('style').value='natural';field('style').dispatchEvent(new Event('change'));
      field('layer').value='0';field('layer').dispatchEvent(new Event('change'));
      return {
        flatTubes:count(flat),cornerTubes:count(corners),splitCornerTubes:count(split),
        lowTubes:count(low),highTubes:count(high),sameDensityTubes:count(sameDensityDifferentCount),partialCover:cover(partial).length,
        fullCover:cover(full).length,fullTriangles:full.userData.surfaceGrowthStats.coverTriangles||0,
        edgePairs:edgePairs.length,edgeCapacity:edgeBound.userData.surfaceGrowthStats.edgeCapacity,
        correctEdges,endpointSeparation,
        wrapHasUvs:!!full.children[0]?.geometry.attributes.uv,
        outline:full.children.find(x=>!x.userData.surfaceGrowthCover)?.layers.mask,
        deterministic:digest(full)===digest(reused),
        houseNatural,houseCorners,houseWrap,namedCount,namedGuideTriangles,rawFurnitureTriangles,guidesInvisible,removed,afterClear,nestedSurvives,outerTriangles,nestedAfterCleanup,
        budgetCorners,budgetNatural,perSurfaceDetails,visibleWallCount:visibleWall.length,visibleCentroids,
        templeSourceArea,templeExposedArea,templeSourceCount,templeRegionCount,templeVisibleRoles,
        templeWrapStats,templeWrapDetails,
        interiorAreaBefore,interiorAreaAfter,
        rawEdgeSpline,curledEdgeSpline,cladEdgeSpline,clearanceEdgeSpline,
        coplanarGable,tessellatedGable,steepGable,disconnectedGable,furnitureStyleAngle,
        transformedGable,
        gappedIntersection,partialCorner,splitCorner,
        regularTunnelSources:regularPanels.length,openingTriangleCount,openingCentroidsInside,
        shrinkRawZ,shrinkFinalZ,insetZ,shrinkStats:shrunk.userData.surfaceGrowthStats,
        hiddenBefore,visibleAfter,budgetLabel,countHidden,paletteChoices,signInsetField,shrinkwrapField,entranceField,
        savedRecipe:recipes[0],restoredStyle:field('style').value,restoredDensity:field('density').value
      };
    });
    assert(data.rawEdgeSpline.rings>=10,'Corner Fill should have intermediate spline rings along long straight architectural edges');
    assert(data.rawEdgeSpline.maxDeviation<.001,'With zero curl and zero clearance the spline must run on the actual corner, not float a radius off it');
    assert(data.curledEdgeSpline.maxDeviation>.008&&data.curledEdgeSpline.maxDeviation<.055,'Curl should be visible but bounded to roughly the strand radius');
    assert(data.curledEdgeSpline.endDeviation<.001,'Cosmetic curl must pin the spline back to the real edge at section endpoints');
    assert(data.cladEdgeSpline.maxDeviation<.001,'Wall cladding clearance must translate the spline along the offset-wall intersection, not away arbitrarily');
    assert(data.clearanceEdgeSpline.maxDeviation<.001,'Authored clearance must preserve the exact intersection of offset wall planes');
    assert(data.gappedIntersection.corners>0&&data.gappedIntersection.maxGapError<.001,
      'Near-gapped wall planes must use their actual plane-intersection line, not either raw mesh edge');
    assert(data.partialCorner.every(x=>x.corners>=1&&x.maxY<=2.01),
      'A shorter adjoining wall must not produce phantom Corner Fill above its last panel');
    assert(data.splitCorner.some(x=>x.maxY-x.minY>3.4),
      'Multiple short panels on a long wall must support a single continuous Corner Fill strand');

    assert.equal(data.transformedGable.regions,1,'A real indexed gable mesh inside a transformed interior must join its coplanar wall panel');
    assert.equal(data.transformedGable.triangles,3,'Interior mesh-source extraction preserves its genuine face count');
    assert.equal(data.coplanarGable.regions,1,'Coplanar wall and triangular gable must be recognized as one surface');
    assert.equal(data.coplanarGable.outerEdges,5,'A combined wall/gable should expose only its five true outline edges');
    assert(data.coplanarGable.outlines>0,'Corner Fill must outline a flat recognized architectural surface');
    assert.equal(data.tessellatedGable.regions,1,'Gable sections with partial T-junction seams must join the parent wall');
    assert.equal(data.tessellatedGable.outerEdges,5,'Coplanar shared T-junction edges must not become outline or Wrap starting seams');
    assert.equal(data.steepGable.regions,2,'Steeply tilted gable remains a different surface');
    assert.equal(data.disconnectedGable.regions,2,'A detached but coplanar gable remains separate');
    assert.equal(data.furnitureStyleAngle.narrow,2,'Architectural split-angle threshold must prevent tight-angle merges');
    assert.equal(data.furnitureStyleAngle.wide,1,'Architecture must support the same configurable split-angle logic as Furniture Author');
    assert(data.interiorAreaBefore>7.9&&data.interiorAreaBefore<8.1,'Interior overlap test must preserve both original quads without clipping');
    assert(data.interiorAreaAfter>5.4&&data.interiorAreaAfter<6.3,
      'Interior backing must not double-count a coplanar wall/gable overlap when detecting exposed surfaces');
    assert(data.templeSourceCount<30,'Real Temple wall and roof navigation must exclude construction-only caps and door-frame thicknesses');
    assert(data.templeRegionCount>=8&&data.templeRegionCount<25,'The Temple must have separate exposed wall and roof surfaces, not a role-wide guide or dozens of internal framing regions');
    assert(data.templeVisibleRoles.walls>2&&data.templeVisibleRoles.roofs>1,
      'Cross-gable exposure must preserve both wall and roof surfaces');
    assert.equal(data.templeWrapStats.surfaces,data.templeVisibleRoles.walls,'Wrap must use only exposed Temple wall regions, not intersecting buried surfaces');
    assert(data.templeWrapStats.generatedStrands>0&&data.templeWrapStats.generatedStrands<=data.templeWrapStats.surfaces*2,
      'Real cross-gabled Temple Wrap must complete edge-to-edge paths without exceeding each surface budget');
    assert(data.templeWrapDetails.every(x=>x.actual<=4),'Temple must enforce the independent per-region strand limit');
    assert(data.templeExposedArea<data.templeSourceArea*.9,
      'The real Temple must trim a meaningful amount of buried intersecting cross-gable geometry');
    assert.equal(data.budgetCorners.surfaces,2,'Both named architectural regions must receive their own budget');
    assert.equal(data.budgetCorners.generatedStrands,6,'3 strands per region × 2 recognized regions, not 3 for the whole house');
    assert.deepEqual(data.perSurfaceDetails.map(x=>x.actual),[3,3],'Strand limit caps each recognized region independently');
    assert.equal(data.budgetNatural.generatedStrands,4,'Opted-in Natural generates two strands on EACH exposed region');
    assert.equal(data.visibleWallCount,1,'Buried seam caps must not become exposed wall regions');
    assert(data.visibleCentroids.length>0&&data.visibleCentroids.every(x=>x>1.88),
      'Clipping must remove the buried wing-wall portions, not merely hide a fully internal mesh');
    assert(data.openingTriangleCount>2&&data.openingCentroidsInside===0,
      'Tunnel-opening mode must cut through broad wall guide triangles without planting inside the entrance');
    assert(data.shrinkStats.shrinkwrapHits>0&&data.shrinkStats.shrinkwrapRays>0,
      'Shrinkwrap must actually raycast against populated bricks');
    assert(data.shrinkFinalZ.max>.25&&data.shrinkFinalZ.max<.36,
      'Shrinkwrap must conform strands to the final brick face without double-moving shared rings');
    assert(Math.abs((data.insetZ.avg-data.shrinkRawZ.avg)-.025)<.001,
      'Signed inset must translate growth uniformly before final-geometry shrinkwrap');
    assert.equal(data.houseNatural.sourceTriangles,96,'Legacy Natural house style must still inspect brick meshes');
    assert.equal(data.houseCorners.sourceTriangles,4,'Corner Fill must follow the two original wall quads, not brick polygons');
    assert.equal(data.houseWrap.sourceTriangles,4,'Wrap navigation must follow the two original wall quads, not brick polygons');
    assert.equal(data.houseCorners.guides,2,'Perpendicular house walls must be two recognized surfaces, not one role-wide mesh');
    assert.equal(data.houseWrap.guides,2,'Wrap must use the same detected architectural surfaces as Corner Fill');
    assert(data.houseCorners.guideHidden&&data.houseWrap.guideHidden,'House guides must be invisible and non-raycastable');
    assert(data.houseCorners.renderLift>=.2&&data.houseWrap.renderLift>=.2,'House cladding must lift strands visibly above source planes');
    assert(data.houseCorners.tubes>0,'Architectural wall intersections must produce actual Corner Fill strands');
    assert.equal(data.namedCount,2,'Furniture must use the two detected, named surfaces');
    assert.equal(data.namedGuideTriangles,4,'Furniture Wrap must sample only the named surface faces');
    assert.equal(data.rawFurnitureTriangles,12,'Furniture Natural must continue sampling all raw visible triangles');
    assert(data.guidesInvisible&&data.removed===0&&data.afterClear===0,'Semantic guide disposal must not leave selectable artifacts');
    assert.equal(data.outerTriangles,2,'Parent growth must not sample nested furniture guide triangles');
    assert.equal(data.nestedSurvives,1,'Parent guide setup must preserve nested furniture guides');
    assert.equal(data.nestedAfterCleanup,1,'Parent guide cleanup must preserve nested furniture guides');
    assert.equal(data.flatTubes,0,'A flat planar surface has no geometric corner');
    assert(data.cornerTubes>0,'Sharp box corners should grow actual tubes');
    assert(data.splitCornerTubes>0,'Slightly gapped wall panels must form a detected corner');
    assert(data.highTubes>data.lowTubes,'Wrap density must affect strand geometry while explicit count is ignored');
    assert.equal(data.lowTubes,data.sameDensityTubes,'Wrap count must no longer control output for a fixed density');
    assert.equal(data.partialCover,0,'Partial densities must not cover the whole wall with a solid sheet');
    assert(data.edgePairs>=12&&data.edgePairs<=80,'Wrap density should emit completed two-edge strands without exceeding the strand limit');
    assert(data.edgeCapacity>=data.edgePairs*2,'Boundary slots, not interior occupancy, determine endpoint capacity');
    assert(data.correctEdges,'Every Wrap strand must begin and end on two different real perimeter edges');
    assert(data.endpointSeparation>=.1,'All Wrap start and end anchors must reserve non-overlapping edge space');

    assert.equal(data.fullCover,0,'Wrap must never generate a flat surface-covering sheet, even at 100% edge density');
    assert.equal(data.fullTriangles,0,'Wrap must not paint the wall interior or cover its triangles');
    assert(data.wrapHasUvs,'Boundary-to-boundary Wrap strands must keep their UV coordinates');
    assert((data.outline&2)!==0,'Raised roots and vines must participate in shell outlines');
    assert(data.deterministic,'Identical saved seed/recipe must regenerate deterministic geometry');
    assert(data.hiddenBefore&&data.visibleAfter,'Wrap density must correctly hide/show in an actual browser DOM');
    assert.equal(data.budgetLabel,'Edge-to-edge strands per surface');
    assert(data.countHidden,'Wrap must hide the now-redundant strand-count input');
    assert(data.paletteChoices>=6,'The shared vegetation palette must expose wilderness materials');
    assert(data.signInsetField&&data.shrinkwrapField&&data.entranceField,'Layer controls must expose inset, final shrinkwrap and tunnel opening');
    assert.equal(data.savedRecipe?.style,'wrap');
    assert.equal(data.savedRecipe?.density,.75);
    assert.equal(data.savedRecipe?.count,9);
    assert.equal(data.savedRecipe?.strandLimit,4);
    assert.equal(data.savedRecipe?.perSurface,true);
    assert.equal(data.restoredStyle,'wrap','Selecting a saved layer must restore its style');
    assert.equal(Number(data.restoredDensity),.75,'Selecting a saved layer must restore density');
    assert.deepEqual(pageErrors,[], 'Shared authoring or growth must not emit browser errors');
    console.log('Surface foliage browser regression passed: flat/corner/gapped meshes, Wrap boundary endpoints/spacing/UVs/outline, seed determinism and shared editor controls.');
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
