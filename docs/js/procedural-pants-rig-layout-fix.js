// Procedural Animation Editor: Pants Rig host sizing correction.
// The embedded author must consume the host panel's remaining height instead of
// falling back to an iframe's intrinsic height while the status footer expands.
(function () {
  'use strict';

  if (document.getElementById('proceduralPantsRigLayoutFixStyles')) return;

  const style = document.createElement('style'); // Overrides only the Pants host layout; authoring content/preview logic stays unchanged.
  style.id = 'proceduralPantsRigLayoutFixStyles';
  style.textContent = `
#proceduralPantsRigPanel.open{
  display:flex!important;
  flex-direction:column!important;
  min-height:0!important;
}
#proceduralPantsRigPanel .pantsRigHostHeader{
  flex:0 0 auto!important;
}
#proceduralPantsRigPanel .pantsRigHostBody{
  flex:1 1 0!important;
  min-height:0!important;
  height:0!important;
  display:flex!important;
  flex-direction:column!important;
  overflow:hidden!important;
}
#proceduralPantsRigPanel #proceduralPantsRigFrame{
  display:block!important;
  flex:1 1 0!important;
  min-height:0!important;
  height:0!important;
  width:100%!important;
  align-self:stretch!important;
  border:0!important;
}
#proceduralPantsRigPanel .pantsRigHostStatus{
  flex:0 0 auto!important;
  min-height:0!important;
  height:auto!important;
  max-height:4.5em!important;
  overflow:auto!important;
  white-space:pre-wrap!important;
}
`;
  document.head.appendChild(style);

  window.ProceduralPantsRigLayoutFix = Object.freeze({
    installed: true,
    snapshot() {
      const panel = document.getElementById('proceduralPantsRigPanel');
      const frame = document.getElementById('proceduralPantsRigFrame');
      const status = document.getElementById('proceduralPantsRigStatus');
      return {
        panelHeight: panel?.getBoundingClientRect?.().height || 0,
        iframeHeight: frame?.getBoundingClientRect?.().height || 0,
        statusHeight: status?.getBoundingClientRect?.().height || 0,
      };
    },
  }); // Mobile-visible diagnostics can inspect actual allocated heights without DevTools.
})();
