// Shared attachment-rig anchor data — the SINGLE canonical source for where a
// mount saddle, shoulder-pet grip, character posterior (seat), and character
// shoulder-perch actually sit in local model space. Exported directly from a
// live animation-author tool session (Export JSON, Rig Coordinates mode) —
// this is the tool's own actual working data (built-in approved entries plus
// on-demand-computed entries for every species/gender the session touched),
// not a hand-reconstructed approximation. Reused wherever something needs to
// attach to a character or creature's body (mounts, shoulder pets, and —
// eventually — characters sitting on furniture via the shared "posterior"
// anchor).
//
// Coordinate convention: every anchor's position.y is expressed in that
// actor's own LOCAL frame where Y=0 is the actor's own model group origin
// (the vertical center of its unscaled idle sprite plane — see
// buildSinglePlaneAvatarModel/buildAnimalPlaneAvatarModel in
// docs/js/png-plane-avatar.js, both of which this data assumes), already
// reflecting each species' own portraitScaleBySpecies height multiplier (see
// cfg().portraitScaleBySpecies in png-plane-avatar.js — matches the tool's
// own "the visible PNG-plane model receives the same portraitModelHeight/2
// runtime lift as game.js" coordinate-space note). rotationDeg is a real
// authored offset (e.g. every creature's shoulderGrip carries -61° yaw) —
// apply it, don't discard it.
//
// The V15.28 character anchors were authored while Animation Author built its
// portrait plane at width 1.0, although game.js builds the same plane at width
// 0.9. The concise character overrides below convert those absolute X/Y/Z
// positions by 0.9. Uniform scaling does not change rotationDeg or percentages.
//
// characters are keyed "<speciesId>::<gender>"; creatures are keyed by their
// CREATURE_DB kind. Missing entries should fall back to a hardcoded estimate
// rather than throwing — re-export from the tool and refresh this file
// whenever a new species/gender gets authored.
window.HOBUNJI_ATTACHMENT_RIG_PROFILES = {"characters":{"tletingan::male":{"species":"tletingan","gender":"male","posteriorRule":{"xMode":"center","ySource":"png-plane-avatar.handAttachY","offsetBasis":"portraitModelHeight","heightPercentOffset":3.824088863116206,"defaultRuleVersion":3},"anchors":{"posterior":{"position":{"x":0,"y":0,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderPerch":{"position":{"x":-0.23428379817847328,"y":0.40698325966374227,"z":0.010201181456531578},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}}},"characterAttachZDefaultVersion":1,"shoulderPerchRule":{"recalculateOnPreview":true}},"engh-sho::male":{"species":"engh-sho","gender":"male","posteriorRule":{"xMode":"center","ySource":"png-plane-avatar.handAttachY","offsetBasis":"portraitModelHeight","heightPercentOffset":0,"defaultRuleVersion":3},"anchors":{"posterior":{"position":{"x":0,"y":0,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderPerch":{"position":{"x":-0.21799141414141415,"y":0.5452999999999998,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}}},"shoulderPerchRule":{"source":"highest-opaque-pixel-of-arm-R-portrait-layer","heightPercentOffset":0,"defaultRuleVersion":4,"sourcePixel":{"x":53.607070707070704,"y":128.5},"portraitModelHeight":0.95,"portraitVerticalPlacementRatio":0.719,"recalculateOnPreview":false},"characterAttachZDefaultVersion":1},"mao-ao::male":{"species":"mao-ao","gender":"male","posteriorRule":{"xMode":"center","ySource":"png-plane-avatar.handAttachY","offsetBasis":"portraitModelHeight","heightPercentOffset":0,"defaultRuleVersion":3},"anchors":{"posterior":{"position":{"x":0,"y":0,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderPerch":{"position":{"x":-0.18472794723825225,"y":0.735,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}}},"shoulderPerchRule":{"source":"highest-opaque-pixel-of-arm-R-portrait-layer","heightPercentOffset":0,"defaultRuleVersion":4,"sourcePixel":{"x":62.554410552349545,"y":125.5},"portraitModelHeight":1,"portraitVerticalPlacementRatio":0.865,"recalculateOnPreview":false},"characterAttachZDefaultVersion":1},"mao-ao::female":{"species":"mao-ao","gender":"female","posteriorRule":{"xMode":"center","ySource":"png-plane-avatar.handAttachY","offsetBasis":"portraitModelHeight","heightPercentOffset":0,"defaultRuleVersion":3},"anchors":{"posterior":{"position":{"x":0,"y":0,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderPerch":{"position":{"x":-0.114727463312369,"y":0.756,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}}},"shoulderPerchRule":{"source":"highest-opaque-pixel-of-arm-R-portrait-layer","heightPercentOffset":0,"defaultRuleVersion":4,"sourcePixel":{"x":76.5545073375262,"y":114.5},"portraitModelHeight":1,"portraitVerticalPlacementRatio":0.831,"recalculateOnPreview":false},"characterAttachZDefaultVersion":1},"rakakoan::male":{"species":"rakakoan","gender":"male","posteriorRule":{"xMode":"center","ySource":"png-plane-avatar.handAttachY","offsetBasis":"portraitModelHeight","heightPercentOffset":10.400973996570313,"defaultRuleVersion":3},"anchors":{"posterior":{"position":{"x":0,"y":0,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderPerch":{"position":{"x":-0.07440705128205127,"y":0.5459999999999999,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}}},"shoulderPerchRule":{"source":"highest-opaque-pixel-of-arm-R-portrait-layer","heightPercentOffset":0,"defaultRuleVersion":4,"sourcePixel":{"x":79.65811965811966,"y":77.5},"portraitModelHeight":0.75,"portraitVerticalPlacementRatio":0.618,"recalculateOnPreview":false},"characterAttachZDefaultVersion":1},"kenkari::male":{"species":"kenkari","gender":"male","posteriorRule":{"xMode":"center","ySource":"png-plane-avatar.handAttachY","offsetBasis":"portraitModelHeight","heightPercentOffset":4.112286027519363,"defaultRuleVersion":3},"anchors":{"posterior":{"position":{"x":0,"y":0,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderPerch":{"position":{"x":-0.07440705128205127,"y":0.5459999999999999,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}}},"shoulderPerchRule":{"source":"highest-opaque-pixel-of-arm-R-portrait-layer","heightPercentOffset":0,"defaultRuleVersion":4,"sourcePixel":{"x":79.65811965811966,"y":77.5},"portraitModelHeight":0.75,"portraitVerticalPlacementRatio":0.618,"recalculateOnPreview":false},"characterAttachZDefaultVersion":1},"kenkari::female":{"species":"kenkari","gender":"female","posteriorRule":{"xMode":"center","ySource":"png-plane-avatar.handAttachY","offsetBasis":"portraitModelHeight","heightPercentOffset":13.825129117684007,"defaultRuleVersion":3},"anchors":{"posterior":{"position":{"x":0,"y":0,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderPerch":{"position":{"x":-0.04346843434343434,"y":0.48525,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}}},"shoulderPerchRule":{"source":"highest-opaque-pixel-of-arm-R-portrait-layer","heightPercentOffset":0,"defaultRuleVersion":4,"sourcePixel":{"x":87.90841750841751,"y":82.5},"portraitModelHeight":0.75,"portraitVerticalPlacementRatio":0.562,"recalculateOnPreview":false},"characterAttachZDefaultVersion":1},"tletingan::female":{"species":"tletingan","gender":"female","posteriorRule":{"xMode":"center","ySource":"png-plane-avatar.handAttachY","offsetBasis":"portraitModelHeight","heightPercentOffset":0.8364390597132664,"defaultRuleVersion":3},"anchors":{"posterior":{"position":{"x":0,"y":0,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderPerch":{"position":{"x":-0.13658473154362422,"y":0.425,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}}},"shoulderPerchRule":{"source":"highest-opaque-pixel-of-arm-R-portrait-layer","heightPercentOffset":0,"defaultRuleVersion":4,"sourcePixel":{"x":67.36241610738254,"y":99.5},"portraitModelHeight":0.85,"portraitVerticalPlacementRatio":0.5,"recalculateOnPreview":false},"characterAttachZDefaultVersion":1},"mashtzarr::male":{"species":"mashtzarr","gender":"male","posteriorRule":{"xMode":"center","ySource":"png-plane-avatar.handAttachY","offsetBasis":"portraitModelHeight","heightPercentOffset":0,"defaultRuleVersion":3},"anchors":{"posterior":{"position":{"x":0,"y":0,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderPerch":{"position":{"x":-0.17766224188790558,"y":1.139,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}}},"shoulderPerchRule":{"source":"highest-opaque-pixel-of-arm-R-portrait-layer","heightPercentOffset":0,"defaultRuleVersion":4,"sourcePixel":{"x":63.96755162241888,"y":87.5},"portraitModelHeight":0.9,"portraitVerticalPlacementRatio":0.675,"recalculateOnPreview":false},"characterAttachZDefaultVersion":1},"mashtzarr::female":{"species":"mashtzarr","gender":"female","posteriorRule":{"xMode":"center","ySource":"png-plane-avatar.handAttachY","offsetBasis":"portraitModelHeight","heightPercentOffset":0,"defaultRuleVersion":3},"anchors":{"posterior":{"position":{"x":0,"y":0,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderPerch":{"position":{"x":-0.13682638888888887,"y":0.51,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}}},"shoulderPerchRule":{"source":"highest-opaque-pixel-of-arm-R-portrait-layer","heightPercentOffset":0,"defaultRuleVersion":4,"sourcePixel":{"x":72.13472222222222,"y":97.5},"portraitModelHeight":0.9,"portraitVerticalPlacementRatio":0.6,"recalculateOnPreview":false},"characterAttachZDefaultVersion":1},"rakakoan::female":{"species":"rakakoan","gender":"female","posteriorRule":{"xMode":"center","ySource":"png-plane-avatar.handAttachY","offsetBasis":"portraitModelHeight","heightPercentOffset":0,"defaultRuleVersion":3},"anchors":{"posterior":{"position":{"x":0,"y":0,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderPerch":{"position":{"x":-0.04346843434343434,"y":0.48525,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}}},"shoulderPerchRule":{"source":"highest-opaque-pixel-of-arm-R-portrait-layer","heightPercentOffset":0,"defaultRuleVersion":4,"sourcePixel":{"x":87.90841750841751,"y":82.5},"portraitModelHeight":0.75,"portraitVerticalPlacementRatio":0.562,"recalculateOnPreview":false},"characterAttachZDefaultVersion":1},"engh-sho::female":{"species":"engh-sho","gender":"female","posteriorRule":{"xMode":"center","ySource":"png-plane-avatar.handAttachY","offsetBasis":"portraitModelHeight","heightPercentOffset":0,"defaultRuleVersion":3},"anchors":{"posterior":{"position":{"x":0,"y":0,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderPerch":{"position":{"x":-0.1309213532513181,"y":0.57855,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}}},"shoulderPerchRule":{"source":"highest-opaque-pixel-of-arm-R-portrait-layer","heightPercentOffset":0,"defaultRuleVersion":4,"sourcePixel":{"x":71.93760984182776,"y":112.5},"portraitModelHeight":0.95,"portraitVerticalPlacementRatio":0.674,"recalculateOnPreview":false},"characterAttachZDefaultVersion":1}},"creatures":{"drenkirra":{"kind":"drenkirra","anchors":{"saddle":{"position":{"x":0,"y":0.09289353489875796,"z":0.02},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderGrip":{"position":{"x":0.01,"y":-0.1636307385658067,"z":0.0009131708735385657},"rotationDeg":{"x":0,"y":-61,"z":0},"scale":{"x":1,"y":1,"z":1}}},"saddleRule":{"source":"built-in-approved-rig-json-v1524","defaultRuleVersion":3,"authoredDefaultVersion":6,"authoredFixed":true,"recalculateOnPreview":false},"shoulderGripRule":{"source":"authored-attachpointsv1","coordinateSpace":"unscaled-idle-png-plane-local","defaultRuleVersion":4,"authoredDefaultVersion":6,"authoredFixed":true,"recalculateOnPreview":false},"sizeScales":{"large":{"x":4,"y":4},"medium":{"x":2,"y":2},"small":{"x":0.9,"y":0.9}},"sizeScaleRule":{"version":1,"axes":"png-plane-local-x-y","zScale":1,"applicationOrder":"before-outer-prism-and-world-bounds","authoredDefaultVersion":6,"authoredFixed":true},"shoulderGripRotationDefaultVersion":2,"creatureShoulderGripDefaultVersion":4,"sizeScalePercentages":{"large":{"x":400,"y":400},"medium":{"x":200,"y":200},"small":{"x":90,"y":90}},"approvedRigDefaultVersion":6},"grehlr":{"kind":"grehlr","anchors":{"saddle":{"position":{"x":0,"y":0.12393333333333335,"z":0},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderGrip":{"position":{"x":0.01,"y":-0.3719770036140037,"z":0},"rotationDeg":{"x":0,"y":-61,"z":0},"scale":{"x":1,"y":1,"z":1}}},"saddleRule":{"source":"highest-opaque-pixel-along-idle-sprite-midline","heightPercentOffset":-5,"defaultRuleVersion":3,"sourcePixel":{"x":1499.5,"y":843.5},"midlineSearchRadiusPx":0,"authoredDefaultVersion":6,"authoredFixed":true,"recalculateOnPreview":false},"shoulderGripRule":{"source":"authored-attachpointsv1","coordinateSpace":"unscaled-idle-png-plane-local","defaultRuleVersion":4,"authoredDefaultVersion":6,"authoredFixed":true,"recalculateOnPreview":false},"sizeScales":{"large":{"x":1,"y":1},"medium":{"x":0.5,"y":0.5},"small":{"x":0.2,"y":0.2}},"sizeScaleRule":{"version":1,"axes":"png-plane-local-x-y","zScale":1,"applicationOrder":"before-outer-prism-and-world-bounds","authoredDefaultVersion":6,"authoredFixed":true},"shoulderGripRotationDefaultVersion":2,"creatureShoulderGripDefaultVersion":4,"sizeScalePercentages":{"large":{"x":100,"y":100},"medium":{"x":50,"y":50},"small":{"x":20,"y":20}},"grehlrSizeScaleDefaultVersion":2,"approvedRigDefaultVersion":6},"gar-wolf":{"kind":"gar-wolf","anchors":{"saddle":{"position":{"x":0,"y":0.14184834174882754,"z":0.2761841625577698},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderGrip":{"position":{"x":0.01,"y":-0.26545210788556156,"z":0.07486897921502367},"rotationDeg":{"x":0,"y":-61,"z":0},"scale":{"x":1,"y":1,"z":1}}},"saddleRule":{"source":"built-in-approved-rig-json-v1524","defaultRuleVersion":3,"authoredDefaultVersion":6,"authoredFixed":true,"recalculateOnPreview":false},"shoulderGripRule":{"source":"authored-attachpointsv1","coordinateSpace":"unscaled-idle-png-plane-local","defaultRuleVersion":4,"authoredDefaultVersion":6,"authoredFixed":true,"recalculateOnPreview":false},"sizeScales":{"large":{"x":1.5,"y":1.5},"medium":{"x":1,"y":1},"small":{"x":0.35,"y":0.35}},"sizeScaleRule":{"version":1,"axes":"png-plane-local-x-y","zScale":1,"applicationOrder":"before-outer-prism-and-world-bounds","authoredDefaultVersion":6,"authoredFixed":true},"shoulderGripRotationDefaultVersion":2,"creatureShoulderGripDefaultVersion":4,"sizeScalePercentages":{"large":{"x":150,"y":150},"medium":{"x":100,"y":100},"small":{"x":35,"y":35}},"approvedRigDefaultVersion":6},"dabinggi-hound":{"kind":"dabinggi-hound","anchors":{"saddle":{"position":{"x":0,"y":0.12212625800404886,"z":0.6091387381509006},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderGrip":{"position":{"x":0.01,"y":-0.20203700498816118,"z":0.09104867302389968},"rotationDeg":{"x":0,"y":-61,"z":0},"scale":{"x":1,"y":1,"z":1}}},"saddleRule":{"source":"highest-opaque-pixel-along-idle-sprite-midline","heightPercentOffset":-5,"defaultRuleVersion":3,"sourcePixel":{"x":687.5,"y":210.5},"midlineSearchRadiusPx":0,"authoredDefaultVersion":6,"authoredFixed":true,"recalculateOnPreview":false},"shoulderGripRule":{"source":"authored-attachpointsv1","coordinateSpace":"unscaled-idle-png-plane-local","defaultRuleVersion":4,"authoredDefaultVersion":6,"authoredFixed":true,"recalculateOnPreview":false},"sizeScales":{"large":{"x":2,"y":2},"medium":{"x":1,"y":1},"small":{"x":0.35,"y":0.35}},"sizeScaleRule":{"version":1,"axes":"png-plane-local-x-y","zScale":1,"applicationOrder":"before-outer-prism-and-world-bounds","authoredDefaultVersion":6,"authoredFixed":true},"shoulderGripRotationDefaultVersion":2,"creatureShoulderGripDefaultVersion":4,"sizeScalePercentages":{"large":{"x":200,"y":200},"medium":{"x":100,"y":100},"small":{"x":35,"y":35}},"approvedRigDefaultVersion":6},"uumkaoii":{"kind":"uumkaoii","anchors":{"saddle":{"position":{"x":0,"y":0.26595632314682005,"z":0.02},"rotationDeg":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"shoulderGrip":{"position":{"x":0.01,"y":-0.5363283597840667,"z":-0.012886930890300352},"rotationDeg":{"x":0,"y":-61,"z":0},"scale":{"x":1,"y":1,"z":1}}},"saddleRule":{"source":"built-in-approved-rig-json-v1524","defaultRuleVersion":3,"authoredDefaultVersion":6,"authoredFixed":true,"recalculateOnPreview":false},"shoulderGripRule":{"source":"authored-attachpointsv1","coordinateSpace":"unscaled-idle-png-plane-local","defaultRuleVersion":4,"authoredDefaultVersion":6,"authoredFixed":true,"recalculateOnPreview":false},"sizeScales":{"large":{"x":1.5,"y":1.5},"medium":{"x":1,"y":1},"small":{"x":0.2,"y":0.2}},"sizeScaleRule":{"version":1,"axes":"png-plane-local-x-y","zScale":1,"applicationOrder":"before-outer-prism-and-world-bounds","authoredDefaultVersion":6,"authoredFixed":true},"shoulderGripRotationDefaultVersion":2,"creatureShoulderGripDefaultVersion":4,"sizeScalePercentages":{"large":{"x":150,"y":150},"medium":{"x":100,"y":100},"small":{"x":20,"y":20}},"approvedRigDefaultVersion":6}}};

// Character rig profiles published with Animation Author V15.28. These concise
// overrides keep the canonical one-line library intact while replacing every
// field that was deliberately reauthored in the supplied character profiles.
(() => {
  const authoredPreviewBaseWidth = 1; // Records the accidentally oversized Animation Author portrait used while these character anchors were positioned.
  const gameAvatarBaseWidth = 0.9; // Matches pngPlaneAvatar.worldModelWidth and the explicit modelWidth used by game.js.
  const authoredPreviewToGameScale = gameAvatarBaseWidth / authoredPreviewBaseWidth; // Converts absolute avatar-local attachment positions into runtime coordinates.
  const updates = { // Applied below to gameplay and every repository-backed authoring preview.
    'mashtzarr::male': { posterior: 0.6880202107561688, posteriorFloor: 28.18802021075617, perch: [-0.3080816783597182, 0.8820611278141346, 0], left: [0.2938287377558306, 0.471474644548211, 0], right: [-0.3481292844745114, 0.5072329547240978, 0], pixel: [63.960809102402024, 87.5], height: 1, placement: 0.755, bodyScale: 1.18, handScale: 0.925, footScale: 1.175, armLength: 0 },
    'tletingan::male': { posterior: 8.329594593937665, posteriorFloor: 24.829594593937666, perch: [-0.17173123931623935, 0.5355, 0], left: [0.22770354382724423, 0.42663710735156957, 0], right: [-0.2448354156580218, 0.4465232083661127, 0], pixel: [59.09264957264957, 108.5], height: 0.85, placement: 0.645, bodyScale: 0.85, handScale: 0.9, footScale: 1, armLength: 6 },
    'kenkari::male': { posterior: 7.633738099540614, posteriorFloor: 13.133738099540614, perch: [-0.18055321970300925, 0.37969897363327487, 0], left: [0.17819817802695415, 0.27810760526210354, 0], right: [-0.18055321970300925, 0.37969897363327487, 0], pixel: [79.65683229813665, 77.5], height: 0.75, placement: 0.51, bodyScale: 0.75, handScale: 1, footScale: 1, armLength: 0 },
    'mao-ao::male': { posterior: -9.686481272760854, posteriorFloor: 37.31351872723915, perch: [-0.29650716367602115, 0.6947557240731601, 0], left: [0.19067248465844266, 0.6947557240731601, 0], right: [-0.28087406205430004, 0.6455541403639915, 0], pixel: [62.551070840197696, 125.5], placement: 0.95, bodyScale: 1, handScale: 1.1, footScale: 1.05, armLength: 0 },
    'engh-sho::male': { posterior: -12.036557901087457, posteriorFloor: 40.46344209891254, perch: [-0.2823783104116402, 0.5175336815283819, 0], left: [0.2721813782445264, 0.6838406837818225, 0], right: [-0.28930388062923146, 0.7000103424366998, 0], pixel: [53.60656565656566, 128.5], height: 0.95, placement: 1.005, bodyScale: 0.95, handScale: 1.15, footScale: 1.275, armLength: 0 },
    'mao-ao::female': { posterior: -4.30199269420537, posteriorFloor: 40.198007305794635, perch: [-0.22083596137467643, 0.6289206407533765, 0], left: [0.1771042396564939, 0.6511546407522855, 0], right: [-0.23898599170593354, 0.646996571654354, 0], pixel: [76.5545073375262, 114.5], height: 1, placement: 0.925, bodyScale: 1, handScale: 1, footScale: 1.025, armLength: 0 },
    'engh-sho::female': { posterior: -8.338179933841042, posteriorFloor: 41.16182006615896, perch: [-0.13091066725197542, 0.69825, 0], left: [0.20505349784094706, 0.4967497459859368, 0], right: [-0.24815066240089945, 0.46042886220274515, 0], pixel: [71.9398595258999, 112.5], height: 0.95, placement: 0.975, bodyScale: 0.95, handScale: 1.225, footScale: 1.325, armLength: 0 },
    'mashtzarr::female': { posterior: -1.540326776219386, posteriorFloor: 29.459673223780613, perch: [-0.21765356423931137, 0.29498687183448, 0], left: [0.30553153725919435, 0.39823082948935073, 0], right: [-0.2938000697183753, 0.37168801102709437, 0], pixel: [72.13592233009709, 97.5], height: 1, placement: 0.79, bodyScale: 1.18, handScale: 0.9, footScale: 1.125, armLength: 0 },
    'kenkari::female': { posterior: 14.996754350465022, posteriorFloor: 18.49675435046502, perch: [-0.13819980616286182, 0.29929878500014695, 0], left: [0.1629792650553279, 0.29929878500014695, 0], right: [-0.16564616738866406, 0.25011972083640993, 0], pixel: [87.90841750841751, 82.5], height: 0.75, placement: 0.51, bodyScale: 0.75, handScale: 0.925, footScale: 1, armLength: 0 },
    'tletingan::female': { posterior: -1.3735593215106594, posteriorFloor: 21.62644067848934, perch: [-0.18362271672504038, 0.30917820531717677, 0], left: [0.19339659287777322, 0.38426858848533485, 0], right: [-0.19326419458235525, 0.38220450093854685, 0], pixel: [67.36241610738254, 99.5], height: 0.85, placement: 0.62, bodyScale: 0.85, handScale: 0.925, footScale: 1.025, armLength: 5 },
  };
  const sharedProfileAliases = { 'rakakoan::male': 'kenkari::male', 'rakakoan::female': 'kenkari::female' }; // Reuses the confirmed gender-matched parrot rig geometry below.
  for (const [aliasKey, sourceKey] of Object.entries(sharedProfileAliases)) updates[aliasKey] = { ...updates[sourceKey], sharedFrom: sourceKey };
  const calibratedIdentityAnchor = ([x, y, z]) => ({
    position: { x: x * authoredPreviewToGameScale, y: y * authoredPreviewToGameScale, z: z * authoredPreviewToGameScale },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  }); // Preserves each authored direction while moving its absolute position onto the game's 0.9-wide avatar.
  for (const [key, authored] of Object.entries(updates)) {
    const profile = window.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters[key]; // Existing species/gender record whose authored fields are replaced in place.
    if (!profile) continue;
    profile.posteriorRule = {
      ...profile.posteriorRule,
      heightPercentOffset: authored.posterior,
      heightPercentFromFloor: authored.posteriorFloor,
      ySource: 'portraitModelHeight-from-floor',
      floorCalibrationSource: 'v15.28-authored-posterior-resolved-at-game-width',
      defaultRuleVersion: 4,
    };
    profile.anchors.shoulderPerch = calibratedIdentityAnchor(authored.perch);
    profile.anchors.leftHandShoulder = calibratedIdentityAnchor(authored.left);
    profile.anchors.rightHandShoulder = calibratedIdentityAnchor(authored.right);
    profile.shoulderPerchRule = {
      ...profile.shoulderPerchRule,
      source: 'imported-authored-rig-json',
      heightPercentOffset: 0,
      defaultRuleVersion: 4,
      sourcePixel: { x: authored.pixel[0], y: authored.pixel[1] },
      ...(Number.isFinite(authored.height) ? { portraitModelHeight: authored.height } : {}),
      portraitVerticalPlacementRatio: authored.placement,
      recalculateOnPreview: false,
      coordinateSpace: 'appearance-species-floor-relative',
      authoredDefaultVersion: 7,
      authoredFixed: true,
      appearanceSpeciesId: profile.species,
      appearanceGender: profile.gender,
    };
    profile.handShoulderRule = {
      source: 'rig-anchor-gizmo',
      coordinateSpace: 'game-avatar-local-0.9-base-width',
      version: 2,
      ...(authored.sharedFrom ? { sharedFrom: authored.sharedFrom } : {}),
    };
    profile.anchorPositionCalibration = {
      sourceBaseWidth: authoredPreviewBaseWidth,
      targetBaseWidth: gameAvatarBaseWidth,
      positionScale: authoredPreviewToGameScale,
      axes: 'x-y-z',
      rotationDeg: 'unchanged-uniform-scale',
      version: 1,
    }; // Makes the one-time repair inspectable in exported/static configuration diagnostics.
    profile.anatomy = {
      portraitVerticalPlacementRatio: authored.placement,
      portraitScale: authored.bodyScale,
      handScale: authored.handScale,
      footScale: authored.footScale,
      armLengthHeightPercentOffset: authored.armLength,
      version: 1,
    }; // Keeps species/gender proportions and free-hand reach beside the anchors they visually depend on.
    profile.characterAttachZDefaultVersion = 1;
  }
  window.HOBUNJI_AUTHORED_CHARACTER_RIG_UPDATES = Object.freeze({ count: Object.keys(updates).length, exactSuppliedProfiles: 10, authoredPreviewBaseWidth, gameAvatarBaseWidth, anchorPositionScale: authoredPreviewToGameScale, sharedProfileAliases: Object.freeze({ ...sharedProfileAliases }) }); // Exposes a mobile-readable diagnostic without requiring DevTools.
})();

window.HOBUNJI_ATTACHMENT_RIG_MATH = Object.freeze({
  characterPosteriorY(posteriorRule, modelHeight, legacyHandAttachY) {
    const height = Number(modelHeight);
    const safeHeight = Number.isFinite(height) && height > 0 ? height : 0.9;
    const floorPercent = Number(posteriorRule?.heightPercentFromFloor);
    if (Number.isFinite(floorPercent)) return safeHeight * floorPercent / 100;
    const legacyOffset = Number(posteriorRule?.heightPercentOffset);
    const legacyBase = Number(legacyHandAttachY);
    return (Number.isFinite(legacyBase) ? legacyBase : safeHeight / 2)
      + safeHeight * (Number.isFinite(legacyOffset) ? legacyOffset : -18) / 100;
  },
}); // One posterior formula is shared by gameplay, procedural limbs, and Animation Author; old pixel-relative profiles remain readable as a fallback.

// Apply profile-backed portrait/limb proportions, including per-gender body
// scale. Animation Author loads shared configs after this file, so expose an
// idempotent hook instead of interrupting its bootstrap.
window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS = { mashtzarrPortraitCorrection: 'pending', anatomyProfiles: 'pending', authoredCharacterProfiles: 12, exactSuppliedProfiles: 10, parrotSharedProfiles: 2, anchorPositionCalibration: 'applied:1.000->0.900', anchorPositionScale: 0.9, posteriorCoordinateSpace: 'portraitModelHeight-percent-from-gameplay-floor', posteriorPixelDependency: 'removed' }; // Exposes delayed correction and authored-profile status through the tool's existing page diagnostics.
(() => {
  const applyAttachmentRigProfileCorrections = () => {
    const pngAvatarConfig = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar; // Receives the authored anatomy values once the shared repository config exists.
    if (!pngAvatarConfig?.portraitScaleBySpecies || !pngAvatarConfig?.portraitVerticalPlacement) return false;
    pngAvatarConfig.proceduralFeet ||= {};
    pngAvatarConfig.proceduralFeet.footScale ||= { default: 1 };
    const handScaleUpdates = []; // Defers hand-profile mutation until that later-loaded runtime exists.
    for (const profile of Object.values(window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {})) {
      const species = String(profile?.species || '').trim().toLowerCase();
      const gender = String(profile?.gender || '').trim().toLowerCase();
      const anatomy = profile?.anatomy || {};
      if (!species || !gender) continue;
      const placement = Number(anatomy.portraitVerticalPlacementRatio);
      const portraitScale = Number(anatomy.portraitScale);
      const handScale = Number(anatomy.handScale);
      const footScale = Number(anatomy.footScale);
      if (Number.isFinite(placement)) {
        pngAvatarConfig.portraitVerticalPlacement[species] ||= {};
        pngAvatarConfig.portraitVerticalPlacement[species][gender] = placement;
      }
      if (Number.isFinite(portraitScale) && portraitScale > 0) {
        const legacyScale = Number(pngAvatarConfig.portraitScaleBySpecies[species]); // Preserves old species-only configs as the fallback for unspecified genders.
        const scaleProfile = typeof pngAvatarConfig.portraitScaleBySpecies[species] === 'object'
          ? pngAvatarConfig.portraitScaleBySpecies[species]
          : { default: Number.isFinite(legacyScale) && legacyScale > 0 ? legacyScale : 1 };
        scaleProfile[gender] = portraitScale;
        pngAvatarConfig.portraitScaleBySpecies[species] = scaleProfile;
      }
      if (Number.isFinite(footScale) && footScale > 0) {
        pngAvatarConfig.proceduralFeet.footScale[species] ||= {};
        pngAvatarConfig.proceduralFeet.footScale[species][gender] = footScale;
      }
      if (Number.isFinite(handScale) && handScale > 0) handScaleUpdates.push({ species, gender, handScale });
    }
    const handProfiles = window.HobunjiHandModelProfiles;
    if (handProfiles?.mutate && handScaleUpdates.length) {
      const needsMutation = handScaleUpdates.some(update => Number(handProfiles.data?.speciesScaleOverrides?.[update.species]?.[update.gender]) !== update.handScale); // Avoids rebuilding every active hand when the deferred hook is called twice.
      if (needsMutation) handProfiles.mutate(data => {
        data.speciesScaleOverrides ||= {};
        for (const update of handScaleUpdates) {
          data.speciesScaleOverrides[update.species] ||= {};
          data.speciesScaleOverrides[update.species][update.gender] = update.handScale;
        }
      });
    }
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.mashtzarrPortraitCorrection = 'applied';
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.anatomyProfiles = handProfiles?.mutate ? 'applied' : 'config-applied; hand-runtime-pending';
    return true;
  };
  window.applyHobunjiAttachmentRigProfileCorrections = applyAttachmentRigProfileCorrections; // Called again after deferred config/hand-profile loads.
  applyAttachmentRigProfileCorrections();
})();
