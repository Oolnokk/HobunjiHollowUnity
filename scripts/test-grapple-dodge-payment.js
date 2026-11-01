// The authoritative game dodge payment, not a copied affordability guess,
// gates both Maskbound Headtaker and Hachutu root-hand escapes.
// Run: node scripts/test-grapple-dodge-payment.js
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const game=fs.readFileSync('docs/game.js','utf8'); // Test actual game.js closure-private performDodge source.
const marker='function performDodge() {';
const start=game.indexOf(marker),end=game.indexOf('\n      }\n',start);
assert(start>0&&end>start,'real game dodge function can be isolated');
const dodgeSource=game.slice(start,end+9);
function runDodge(stamina,spend,other={}){
  const player={stamina,inputStrength:1,inputX:1,inputY:0,angle:0,
    dodging:false,dodgeCooldownT:0,prone:false,exhaustion:{active:false},...other};
  const context={player,Math,performance:{now:()=>100},DODGE_STAMINA_COST:18,
    DODGE_DUR_S:.38,DODGE_COOLDOWN_S:.75,DODGE_IFRAME_MS:380,
    window:{ResourceSystem:spend?{spendStamina:(actor,amount,reason)=>spend(actor,amount,reason)}:null}};
  vm.runInNewContext(dodgeSource+';performDodge()',context);
  return player;
}
const full=runDodge(18,(p,cost,reason)=>{
  assert.equal(reason,'dodge');
  const spent=Math.min(cost,p.stamina);p.stamina-=spent;return {spent,excess:cost-spent,enhancedPaid:0};
});
assert(full.dodging&&full._grappleEscapeDodgePaid===true,'funded roll animates and can break a grab');
const empty=runDodge(0,(p,cost)=>({spent:0,excess:cost,enhancedPaid:0}));
assert(empty.dodging&&empty._grappleEscapeDodgePaid===false,'Exhausted debt roll animates but cannot escape');
const partial=runDodge(5,(p,cost)=>{const spent=p.stamina;p.stamina=0;return {spent,excess:cost-spent,enhancedPaid:0};});
assert(partial.dodging&&!partial._grappleEscapeDodgePaid,'partially funded dodge cannot break a grab');
const enhanced=runDodge(0,(p,cost)=>({spent:0,excess:0,enhancedPaid:cost}));
assert(enhanced._grappleEscapeDodgePaid,'enhanced Stamina covering the whole cost counts as genuinely paid');
assert(!runDodge(0,null)._grappleEscapeDodgePaid,'resource-system fallback also respects zero Stamina');
assert(runDodge(18,null)._grappleEscapeDodgePaid,'resource-system fallback permits fully funded rolls');
const context={console,Combat:{deps:{player:empty}}};context.window=context;
vm.runInNewContext(fs.readFileSync('docs/js/combat/combat-attach.js','utf8'),context);
const escape=context.Combat.attach.hostDodgeEscapes;
assert.equal(escape(empty),false,'shared attachment predicate rejects unpaid player rolls');
assert.equal(escape(partial),false,'shared attachment predicate rejects partially funded rolls');
context.Combat.deps.player=full;
assert.equal(escape(full),true,'shared attachment predicate accepts the paid roll');
context.Combat.deps.player=enhanced;
assert.equal(escape(enhanced),true,'shared attachment predicate accepts enhanced payment');
const npc={dodging:true};
assert.equal(escape(npc),true,'NPC dodge behavior unaffected');
const stationaryNpc={dodging:false,dodgeT:0,_enemyDodge:false};
assert.equal(escape(stationaryNpc),false,'idle NPC cannot trigger detach');
const head=fs.readFileSync('docs/js/combat/combat-maskbound-headtaker.js','utf8');
const roots=fs.readFileSync('docs/js/dev-hachutu-ruin.js','utf8');
assert(head.includes('validEscapeDodge(state.target)'), 'Headtaker landing delegates to funded dodge predicate');
assert(roots.includes('hostDodgeEscapes?.(deps.player)'), 'root hands reuse the same predicate');
assert(roots.includes('!tear?.active?.()'), 'an exhausted roll across the labyrinth boundary cannot cancel an ongoing tear');
console.log('PASS grapple dodge payment: full/partial/zero/enhanced, Headtaker/root integration, NPC compatibility and boundary safety');
