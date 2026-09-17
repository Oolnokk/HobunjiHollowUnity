'use strict';

// author-part6 has to install before this so its shoulder presentation helpers
// exist. This tiny final wrapper refreshes run1/split art only AFTER applyRecord
// has committed the newly selected record to state.baseRecord; otherwise a fast
// animal switch can briefly request the previous species' run1 frame.
const shoulderAwareApplyRecord=applyRecord; // Current applyRecord already restores the saved shoulder configuration.
applyRecord=function applyRecordThenRefreshShoulderFrame(record,index=-1){
  const result=shoulderAwareApplyRecord(record,index);
  clearShoulderFrameCache();
  refreshShoulderPresentation();
  return result;
};

// The sticky workbench can be much wider than the vertical space available to
// each preview. Do not stretch the canvas itself to that wide/shallow grid cell:
// keep the canvas at the sprite's real aspect and let the checkerboard host take
// the spare space. This preserves the entire PNG in both views while the settings
// panel below is the part that compresses/scrolls on short screens.
function fitCanvasInsideHost(canvas){
  const host=canvas?.parentElement?.getBoundingClientRect?.(); // Available grid-cell rectangle used to contain the full sprite.
  if(!host?.width||!host?.height)return;
  const source=sourceSize();
  const aspect=source.width>0&&source.height>0?source.width/source.height:host.width/Math.max(1,host.height); // Loaded sprite aspect is authoritative once known.
  let cssWidth=host.width,cssHeight=cssWidth/Math.max(.0001,aspect);
  if(cssHeight>host.height){cssHeight=host.height;cssWidth=cssHeight*aspect}
  cssWidth=Math.max(1,cssWidth);cssHeight=Math.max(1,cssHeight);
  canvas.style.width=`${cssWidth}px`;
  canvas.style.height=`${cssHeight}px`;
  const dpr=Math.max(1,window.devicePixelRatio||1); // Backing resolution follows the contained CSS rectangle rather than the whole shallow host.
  const pixelWidth=Math.max(1,Math.round(cssWidth*dpr)),pixelHeight=Math.max(1,Math.round(cssHeight*dpr));
  if(canvas.width!==pixelWidth)canvas.width=pixelWidth;
  if(canvas.height!==pixelHeight)canvas.height=pixelHeight;
}

resizeCanvases=function resizeContainedRigCanvases(){
  fitCanvasInsideHost(paintCanvas);
  fitCanvasInsideHost(previewCanvas);
  draw();
};

// part5 already registered observers using the older resize function. Register a
// later observer as the final layout pass so any viewport/grid change is followed
// by the aspect-correct contained sizing above.
const containedCanvasObserver=new ResizeObserver(()=>resizeCanvases()); // Keeps both views fully visible when the sticky workbench changes size.
containedCanvasObserver.observe(paintCanvas.parentElement);
containedCanvasObserver.observe(previewCanvas.parentElement);
window.addEventListener('resize',resizeCanvases);
resizeCanvases();
