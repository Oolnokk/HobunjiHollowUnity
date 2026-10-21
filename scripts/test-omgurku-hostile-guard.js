'use strict';
// A custom enemy roster must not corrupt a hybrid or strand its live resources.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/js/combat/combat-bandit.js','utf8'); // Execute the actual avatar factory until it rejects unsupported compound conversion.
const factory=source.slice(source.indexOf('  async function buildBanditAvatar('),source.indexOf('  function copyBanditExpressionCanvas('));
let disposed=0;
const portrait={userData:{omgurkuComposite:{}},get children(){throw new Error('compound geometry must never be extracted as two rigid planes');}};
const profile={fighter:{speciesId:'omgurku',gender:'male'},bodyColors:{}};
const context={window:{NpcAvatarPreview:{ensurePortraitCosmetics:async()=>{},buildProfileFromNpcExport:()=>profile,renderProfileToCanvas:async()=>{}},
  PNGPlaneAvatar:{buildSinglePlaneAvatarModel:()=>portrait,disposeAvatarModel:value=>{assert.equal(value,portrait);disposed++;}}},
  document:{createElement:()=>({getContext:()=>({drawImage(){}})})},THREE:{},COMBAT_FROWN_COMPOSER:{},
  characterBuildStatus:{},applyRosterDyesToProfile:()=>({})};
vm.createContext(context);vm.runInContext(factory+';this.build=buildBanditAvatar;',context);
(async()=>{
  await assert.rejects(context.build({appearance:{speciesId:'omgurku',gender:'male'}}),/compound combat avatar/);
  assert.equal(disposed,1,'rejecting unsupported enemy conversion releases the complete hybrid exactly once');
  console.log('Omgurku hostile conversion guard passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
