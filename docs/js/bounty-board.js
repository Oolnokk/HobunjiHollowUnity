// Khymeryyan bandit-captain naming forge ported from the approved standalone name-forge prototype.
// Co-located here so the existing static bounty-board load order remains unchanged and no runtime script injection is needed.
(() => {
'use strict';
// Bandit-captain runtime port of khymeryyan_all_culture_name_forge.html.
// Used by bounty-board.js after a captain's actual species/gender are known.
const FIRST=['Ash','Bitter','Black','Bog','Bronze','Broken','Copper','Crooked','Dagger','Dead','Flat','Grim','Long','Mangrove','Marsh','Mud','Night','Quick','Ragged','Red','River','Rot','Salt','Short','Soot','Split','Stone','Storm','Thorn'];
const SECOND=['Crook','Cutter','Dagger','Drench','Gash','Hook','Hound','Knife','Lash','Murk','Notch','Prowler','Rat','Rend','Ripper','Scratcher','Slinker','Snap','Snarl','Squall','Thorn','Wood'];
const SPECIES={mashtzarr:'mashtzarr','mao-ao':'mao_ao',kenkari:'kenkari',tletingan:'slagothim',slagothim:'slagothim','engh-sho':'engh_sho'};
const SYL={crooked:2,ragged:2,bitter:2,broken:2,dagger:2,mangrove:2,river:2,cutter:2,prowler:2,ripper:2,scratcher:2,slinker:2};
const ANATOMY=new Set(['finger','fingers','thumb','thumbs','knuckle','knuckles','hand','hands','palm','palms','fist','fists','beak','beaks','blood','bone','bones','bristle','bristles','claw','claws','crest','crests','ear','ears','eye','eyes','fang','fangs','feather','feathers','foot','feet','fur','gut','guts','hide','hides','hoof','hooves','horn','horns','jaw','jaws','muzzle','muzzles','paw','paws','scale','scales','skull','skulls','snout','snouts','tail','tails','talon','talons','tooth','teeth','trunk','trunks','tusk','tusks','whisker','whiskers','wing','wings']);

// Deterministic seed helpers are used by every cultural generator and by nickname formatting.
function hash(s){let h=2166136261>>>0;for(const ch of String(s||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return h>>>0}
function rng(seed){let a=hash(seed);return()=>{let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
function pick(r,a){if(!a?.length)throw Error('Empty name pool');return a[Math.floor(r()*a.length)]}
function wp(r,o){const e=Object.entries(o).filter(([,w])=>Number(w)>0);let n=r()*e.reduce((s,[,w])=>s+Number(w),0);for(const [v,w] of e){n-=Number(w);if(n<=0)return v}return e.at(-1)[0]}
function tc(s){s=String(s||'').toLowerCase();return s?s[0].toUpperCase()+s.slice(1):''}
function tcc(s){return String(s||'').split(/([-' ])/).map(x=>/^[a-z]/i.test(x)?tc(x):x).join('')}
function randSeed(prefix){const c=globalThis.crypto;if(c?.getRandomValues){const a=new Uint32Array(2);c.getRandomValues(a);return`${prefix}:${a[0].toString(36)}:${a[1].toString(36)}`}return`${prefix}:${Date.now().toString(36)}:${Math.floor(Math.random()*0x100000000).toString(36)}`}

// Mashtzarr source pools/constraints; used when a captain's speciesId is mashtzarr.
const M={refs:new Set(['Dzibim','Kzubug','Gaz','Kragzid','Tzatzul','Nashkha','Khibu','Rikhid','Tshibir','Tshazhum','Bazug','Banug','Tziz','Kharrar','Makharr','Khizu','Ikhid','Ganag'].map(x=>x.toLowerCase())),v:{a:9,i:8,u:7},on:{'':1,b:3,dz:2,g:2,kh:4,kr:2,kz:2,m:2,n:2,r:2,tsh:3,tz:3},br:{b:5,gz:1,kh:4,n:3,rr:2,shkh:1,tz:2,z:3,zh:2},mc:{d:4,g:6,l:2,m:4,r:5,rr:1,z:4},fs:{a:1,i:1},ms:{1:2,2:16},ws:{2:15,3:3},ss:{1:2,2:16,3:3},sc:{'':5,d:4,g:6,l:2,m:4,r:5,rr:1,z:4}};
function masWord(seed,gender,surname=false){const r=rng(`${seed}:mashtzarr:${surname?'surname':`given:${gender}`}`);for(let a=0;a<160;a++){const on=gender==='female'&&!surname?Object.fromEntries(Object.entries(M.on).filter(([k])=>!k.includes('kr'))):M.on,br=gender==='female'&&!surname?Object.fromEntries(Object.entries(M.br).filter(([k])=>!k.includes('kr'))):M.br,sw=surname?M.ss:(gender==='female'?M.ws:M.ms),n=Number(wp(r,sw));let v=wp(r,M.v),s=wp(r,on)+v;for(let i=0;i<Math.max(0,n-1);i++){const b=wp(r,br);if(gender==='female'&&!surname&&i===n-2){const nv=wp(r,M.fs);s+=b+nv;v=nv}else{const alt=Object.fromEntries(Object.entries(M.v).filter(([k])=>k!==v)),nv=r()<.38?wp(r,M.v):wp(r,Object.keys(alt).length?alt:M.v);s+=b+nv;v=nv}}if(surname){const cod=/[iu]$/i.test(s)?M.sc:Object.fromEntries(Object.entries(M.sc).filter(([k])=>k!=='z'&&k!=='l')),c=wp(r,cod);if(c)s+=c}else if(gender==='male'){if(n>1&&r()<.12){if(!s.endsWith('u'))s=s.slice(0,-1)+'u'}else s+=wp(r,M.mc)}else if(n<=1)s+=wp(r,M.fs);const name=tc(s),low=name.toLowerCase(),vowels=(name.match(/[aiu]/gi)||[]).length,cluster=/[^aiu]{2,}/i.test(name),genderOk=surname||(gender==='female'?/[ai]$/i.test(name)&&!low.includes('kr'):!/[ai]$/i.test(name)),endOk=!surname||!(/([aeiou])([zl])$/i.test(name)&&!/[iu]/.test(name.match(/([aeiou])([zl])$/i)?.[1]||'')),valid=name.length>=3&&name.length<=14&&/^[a-z]+$/i.test(name)&&/[aiu]/i.test(name)&&!/[aiu]{2}/i.test(name)&&!/(.)\1\1/i.test(name)&&!/^(rr|shkh|zh)/i.test(name)&&vowels===n&&cluster&&endOk&&genderOk&&!M.refs.has(low);if(valid)return name}throw Error('Mashtzarr name generation failed')}
function mashtzarr(seed,gender){const given=masWord(`${seed}:given`,gender,false),surname=masWord(`${seed}:surname`,gender,true);return{givenName:given,surname,loreName:`${given} ${surname}`}}

// Mao-ao source phonemes and positioned-syllable rules; used by mao-ao captains.
const MAO={c:['w','r','t','y','p','s','f','g','h','j','b','n','m','k','d'],cl:['sh','hy','br','dr','fr','gr','pr','sr','shr','tr'],v:['a','e','i','o','u','ai','ao'],dip:['ai','ao']};
function maoSyl(r,pattern,opt={}){if(!pattern.includes('V'))return pattern;const m=pattern.match(/^(.*)\{([^}]+)\}$/),base=m?m[1]:pattern,forced=m?m[2].split('|'):null,startCV=base.startsWith('CV'),coda=base.slice(startCV?2:1);let ons=MAO.c.concat(MAO.cl);if(opt.usedR)ons=ons.filter(x=>!(x.length>1&&x.endsWith('r')));let vs=MAO.v.slice();if(opt.middle||opt.usedDip)vs=vs.filter(x=>!MAO.dip.includes(x));if(opt.surnameFirst)vs=vs.filter(x=>x!=='ai');if(forced)vs=vs.filter(x=>forced.includes(x));if(coda)vs=vs.filter(x=>!MAO.dip.includes(x));const v=pick(r,vs),force=String(opt.force||'').toLowerCase(),o=startCV?(force&&MAO.c.includes(force)?force:pick(r,ons)):'';return o+v+coda}
function maoJoin(a){let s=a[0];for(let i=1;i<a.length;i++){let n=a[i];if(s.endsWith('n')&&n.startsWith('n')&&!n.startsWith('ng'))n=n.slice(1);const ev=MAO.v.some(v=>s.endsWith(v)),sv=MAO.v.some(v=>n.startsWith(v));s+=(ev&&sv?"'":'')+n}return s}
function maoSurname(r){const a=[];let dip=false,ur=false;const p=pick(r,['CV','CVn','CVng','CVr']),s=maoSyl(r,p,{surnameFirst:true});a.push(s);dip=MAO.dip.some(x=>s.includes(x));ur=MAO.cl.some(x=>x.endsWith('r')&&s.startsWith(x));let choices=['jei','ji','jo','CV{e}','CV{i}','CV{o}','CV{u}','CV{ai}'];if(!/n$/i.test(s)||/ng$/i.test(s))choices=choices.filter(x=>!x.includes('{ai}')&&!/^j/.test(x));if(dip)choices=choices.filter(x=>!x.includes('{ai}')&&!x.includes('ei'));a.push(maoSyl(r,pick(r,choices),{usedDip:dip,usedR:ur}));return maoJoin(a)}
function mao(seed,gender){const r=rng(seed),sn=maoSurname(r),a=[];let dip=false,ur=false;const first=gender==='female'?pick(r,['V','Vn','Vng']):pick(r,['CV','CVn','CVng','CVr']);let s=maoSyl(r,first,{force:gender==='male'?sn[0]:''});a.push(s);dip=MAO.dip.some(x=>s.includes(x));ur=MAO.cl.some(x=>x.endsWith('r')&&s.startsWith(x));s=maoSyl(r,pick(r,gender==='female'?['CV','CVn']:['CV','CVn','CVr']),{middle:true,usedDip:dip,usedR:ur});a.push(s);dip=dip||MAO.dip.some(x=>s.includes(x));ur=ur||MAO.cl.some(x=>x.endsWith('r')&&s.startsWith(x));let last=gender==='female'?['CV{a}','CV{i}','CV{ai}']:['jei','ji','jo','CV{e}','CV{i}','CV{o}','CV{u}','CV{ai}'];if(!/n$/i.test(s)||/ng$/i.test(s))last=last.filter(x=>!x.includes('{ai}')&&!/^j/.test(x));if(dip)last=last.filter(x=>!x.includes('{ai}')&&!x.includes('ei'));a.push(maoSyl(r,pick(r,last),{usedDip:dip,usedR:ur}));const given=tcc(maoJoin(a)),surname=tcc(sn);return{givenName:given,surname,loreName:`${given} ${surname}`}}

// Kenkari source templates/patronymics; included for future bandit species-weight changes.
const K={c:['b','g','h','k','m','n','p','r','t'],cw:{b:1,g:7,h:7,k:11,m:10,n:10,p:8,r:8,t:8},fc:{b:1,g:4,h:3,k:12,m:12,n:13,p:5,r:3,t:4},gc:{b:1,g:3,h:2,k:12,m:12,n:14,p:3,r:1,t:2},v:['a','e','i','o','u','ai','ey'],vw:{a:11,e:4,i:11,o:8,u:10,ai:4,ey:4},fv:{a:12,i:13,o:4,u:11,ai:5,ey:0,ao:5},tpl:[[['V',"'V",'CV'],18],[['CV',"'V"],18],[['CV','CV'],18],[['CV',"'V",'CV'],16],[['CV','CV','CV'],12],[['V',"'V",'CV','CV'],8]]};
function kentpl(r){const o={};K.tpl.forEach(([p,w],i)=>o[i]=w);return K.tpl[Number(wp(r,o))][0]}
function kenPart(r,t,i,last,marked,after){let vs=K.v.slice();if(!marked)vs=vs.filter(v=>v!=='ai'&&v!=='ey');if(last)vs=vs.filter(v=>v!=='e').concat(marked?['ao']:[]);const w=last?K.fv:K.vw,v=wp(r,Object.fromEntries(vs.map(x=>[x,w[x]??1])));if(t==='V')return v;if(t==="'V")return"'"+v;const cw=after&&last?K.gc:(last?K.fc:K.cw);return wp(r,Object.fromEntries(K.c.map(x=>[x,cw[x]??1])))+v}
function kenGiven(r,gender){for(let a=0;a<40;a++){const t=kentpl(r),parts=[];for(let i=0;i<t.length;i++){const last=i===t.length-1,used=parts.some(x=>/ai|ey|ao/.test(x)),marked=last?r()<.28:(!used&&r()<.18);parts.push(kenPart(r,t[i],i,last,marked,i>0&&t[i-1]==="'V"))}const n=parts.join('').replace(/e(?=')/g,'ey'),first=parts[0]||'',c=/^[bgkhmnprt]/.test(first)?first[0]:'';const conflict=gender==='female'&&(n.includes('p')||c==='r'||c==='t')||gender==='male'&&/(mi|mey)$/i.test(n);let seenI=false,badIA=false;for(const p of parts){if(seenI&&/a/.test(p))badIA=true;if(/i/.test(p))seenI=true}if(!/e$/i.test(n)&&(n.match(/'/g)||[]).length<=1&&(n.match(/ai|ey|ao/g)||[]).length<=1&&!/(pey|ora)$/i.test(n)&&!badIA&&!conflict)return n}throw Error('Kenkari name generation failed')}
function kenkari(seed,gender){const r=rng(seed),given=tcc(kenGiven(r,gender)),father=tcc(kenGiven(r,'male')),surname=`${gender==='female'?'u':'ao'} ${father}`;return{givenName:given,surname,loreName:`${given} ${surname}`}}

// Tletingan/Slagothim source Sl-/suffix/place rules; used by tletingan captains.
const S={loc:['Ikinga','Bahangi','Hatonga','Rahingi',"B'bonga",'Niringi','Ununga','Gorungi'],c1:['b','g','n','p','t','d','k','m','sl','shr','tr','gr','br','gl'],v:['a','e','i','o','u'],c2:['b','g','p','t','d','k','r','n','ng']};
function slag(seed,gender){const r=rng(seed);for(let a=0;a<80;a++){const sl=r()<.58,suf=sl?r()<.2:true,c1=sl?'sl':pick(r,S.c1),v1=pick(r,S.v),c2=r()<.08?'mn':pick(r,S.c2),allows=['ng','r','mn'].includes(c2),forces=c2==='mn';let v2='',end='';if(suf){if(forces||(allows&&r()<.55))v2=pick(r,S.v);end=gender==='female'?'mira':'mir'}else{if(!sl||!allows)continue;v2=pick(r,gender==='female'?['a','i']:['o','u'])}const given=tc(c1+v1+c2+v2+end),low=given.toLowerCase();if(gender==='male'){if(!(low.startsWith('sl')||low.endsWith('mir')))continue;if(low.startsWith('sl')&&!low.endsWith('mir')&&!/[ou]$/i.test(given))continue}else{if(!(low.startsWith('sl')||low.endsWith('mira')))continue;if(low.startsWith('sl')&&!low.endsWith('mira')&&!/[ai]$/i.test(given))continue}const surname=`tley ${tcc(pick(r,S.loc))}`;return{givenName:given,surname,loreName:`${given} ${surname}`}}throw Error('Slagothim name generation failed')}

// Engh-sho source object lexicon and weighted surname phonology; used by engh-sho captains.
const E=['acorn','ael','aestel','amber','amethyst','awl','bar','barb','bead','bean','bell','beryl','billet','bit','blade','bladelet','blank','block','bodkin','bone','borer','boss','brad','brooch','buckle','bud','burin','burr','button','cake','carnelian','catch','catchplate','chalcedony','chape','chisel','chip','clasp','coil','coin','comb','cone','core','counter','cramp','crucible','crystal','cube','cup','cupel','cylinder','die','disc','dowel','drop','dyse','earring','emerald','eyelet','farthing','ferrule','file','firestone','flan','flint','fork','garnet','gem','gim','gimstan','gouge','grain','graver','hasp','hinge','hobnail','hone','hook','hring','husk','hwirfel','ingot','jasper','jewel','kernel','key','knife','knob','knucklebone','lamp','leaf','link','lock','lodestone','loop','matrix','mirror','mount','naegl','nail','needle','nut','obol','onyx','opal','peg','pendant','pening','penny','pin','pinhead','pip','pit','plaque','plug','pod','point','preon','probe','punch','quartz','reed','rind','ring','rivet','rod','root','roundel','ruby','sapphire','sceat','sceatt','scraper','seed','shell','sherd','shuttle','sliver','socket','spatula','spindle','spinel','spool','spoon','sprig','stalk','stan','stem','sticca','stone','stud','styca','stylus','tablet','tack','tag','tally','terminal','tessera','thimble','thorn','tip','toggle','token','tooth','tube','twig','wedge','weight','whetstone','whorl','wire'];
const ER={m:{amber:'gold-resin',amethyst:'purple-stone',barb:'sharp-point',beryl:'green-gem',crystal:'clear-stone',emerald:'green-jewel',jewel:'fine-gem',opal:'milk-gem',ruby:'red-gem',sapphire:'blue-gem'},f:{brad:'small-nail',bud:'new-leaf',jasper:'spotted-stone',stan:'grey-stone'},o:{n:16,m:13,k:13,t:13,p:11,l:5,w:4,y:4,h:4},v:{a:20,u:16,i:4},fin:{k:22,p:14,t:8,b:2,d:2,g:2,kk:10,pp:6,tt:4,nk:10,mp:6,nt:5,lk:4,rk:4}};
function engh(seed,gender){const r=rng(seed),raw=pick(r,E),given=tcc((gender==='female'?ER.f:ER.m)[raw]||raw),n=2+Math.floor(r()*2);let sn='';for(let i=0;i<n-1;i++)sn+=(i===0&&r()<.1?'':wp(r,ER.o))+wp(r,ER.v)+(r()<.5?pick(r,['k','n','p']):'');sn+=wp(r,ER.o)+wp(r,ER.v)+wp(r,ER.fin);const surname=tc(sn);return{givenName:given,surname,loreName:`${given} ${surname}`}}

// Nickname validation/formatting mirrors the forge: no anatomy/iron/steel and fewer than four estimated syllables.
function syllable(w){w=String(w||'').toLowerCase();if(SYL[w])return SYL[w];if(w.length<=3)return 1;let n=(w.match(/[aeiouy]+/g)||[]).length;if(/e$/.test(w)&&!/[aeiouy]le$/.test(w)&&!/[^aeiouy]le$/.test(w)&&n>1)n--;if(/ed$/.test(w)&&!/(ted|ded)$/.test(w)&&n>1)n--;return Math.max(1,n)}
function banned(w){if(/iron|steel/i.test(w))return true;return String(w||'').toLowerCase().split(/[-']/).some(x=>ANATOMY.has(x))}
function nickname(seed){const pairs=[];for(const a of FIRST)for(const b of SECOND){if(a.toLowerCase()===b.toLowerCase()||banned(a)||banned(b))continue;const s=syllable(a)+syllable(b);if(s>0&&s<4)pairs.push({name:tcc(a)+b.toLowerCase(),syllables:s,words:[a,b]})}return pick(rng(`${seed}:nick:pair`),pairs)}
function insert(lore,nick){const p=String(lore).split(/\s+/).filter(Boolean);return p.length<=1?`${lore} “${nick}”`:`${p[0]} “${nick}” ${p.slice(1).join(' ')}`}
function loreIdentity(seed,gender,culture){if(culture==='mashtzarr')return mashtzarr(seed,gender);if(culture==='mao_ao')return mao(seed,gender);if(culture==='kenkari')return kenkari(seed,gender);if(culture==='slagothim')return slag(seed,gender);if(culture==='engh_sho')return engh(seed,gender);throw Error(`Unknown culture ${culture}`)}

// Public generator used for live captain entities after their appearance has already been rolled.
function generateCaptainIdentity(o={}){const speciesId=String(o.speciesId||'').toLowerCase(),culture=SPECIES[speciesId];if(!culture)throw Error(`Unsupported captain species "${speciesId||'unknown'}"`);const gender=['male','female'].includes(o.gender)?o.gender:(rng(`${o.seed}:gender`)()<.5?'male':'female'),seed=String(o.seed||randSeed(`bandit:${speciesId}:${gender}`)),base=loreIdentity(seed,gender,culture),nick=nickname(seed),nicknameOnly=o.forceNicknameOnly||rng(`${seed}:nick:format`)()<Math.max(0,Math.min(1,Number(o.nicknameOnlyChance??.2)));const display=nicknameOnly?nick.name:insert(base.loreName,nick.name);return{speciesId,cultureId:culture,gender,seed,...base,nickname:nick.name,nicknameSyllables:nick.syllables,nicknameOnly,display,name:display}}

// Public alias generator used before a bounty target has any species/gender; nickname-only is explicitly culture-independent in the forge.
function generateNicknameOnly(o={}){const seed=String(o.seed||randSeed('bandit-bounty')),n=nickname(seed);return{seed,display:n.name,name:n.name,nickname:n.name,nicknameSyllables:n.syllables,nicknameOnly:true}}

// Mobile-friendly deterministic smoke test and sample report are routed into the game's existing debug log by BountyBoard.
function selfTest(n=6){n=Math.max(1,Math.min(20,Math.floor(Number(n)||6)));const errors=[],ids=Object.keys(SPECIES);for(const speciesId of ids)for(const gender of ['male','female'])for(let i=0;i<n;i++){const seed=`test:${speciesId}:${gender}:${i}`;try{const a=generateCaptainIdentity({speciesId,gender,seed}),b=generateCaptainIdentity({speciesId,gender,seed});if(!a.display||a.display!==b.display||!a.nickname||a.nicknameSyllables>=4||banned(a.nickname))errors.push(`${speciesId}/${gender}/${i}`)}catch(e){errors.push(`${speciesId}/${gender}: ${e.message}`)}}return{ok:!errors.length,errors,samples:ids.length*2*n}}
function debugSampleText(n=1){n=Math.max(1,Math.min(4,Math.floor(Number(n)||1)));const out=[];for(const speciesId of Object.keys(SPECIES))for(const gender of ['male','female'])for(let i=0;i<n;i++){const x=generateCaptainIdentity({speciesId,gender,seed:`debug:${speciesId}:${gender}:${i}`});out.push(`${speciesId}/${gender}: ${x.display}`)}return out.join('\n')}

window.BanditNameForge={sourceVersion:'khymeryyan-all-culture-name-forge-v7',generateCaptainIdentity,generateNicknameOnly,selfTest,debugSampleText,cultureIdForSpecies:id=>SPECIES[String(id||'').toLowerCase()]||null};
})();

(() => {
  'use strict';

  // Bounty board — hunt a named bandit captain, destroy their camp. A bounty
  // rides the same questProgress/setQuestStatus scaffold as a board/favor
  // task (kind: 'bounty' instead of 'board'/'favor'), so it needs no new
  // save container. The bounty progress record now also persists the captain's
  // preselected species/gender/name seed so a session-only camp rebuilt after
  // reload cannot silently create a different-looking person behind the same
  // wanted poster.
  let deps = null;
  let _banditGangConfigPromise = null; // Preloads the weighted species config used when a bounty must invent a future captain.

  function _loadBanditGangConfig() {
    if (!_banditGangConfigPromise) _banditGangConfigPromise = window.BanditCombat.loadGangConfig();
    return _banditGangConfigPromise;
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    void _loadBanditGangConfig();
    const forge = window.BanditNameForge;
    if (!forge) {
      deps.debugLog?.('Bandit captain name forge unavailable at BountyBoard.init().', 'warn');
      return;
    }
    const result = forge.selfTest(8);
    if (result.ok) deps.debugLog?.(`Bandit captain name forge self-test passed (${result.samples} generated identities).`, 'info');
    else deps.debugLog?.(`Bandit captain name forge self-test FAILED: ${result.errors.join(' | ')}`, 'warn');
  }

  const BOUNTY_RANK_LABELS = ['Petty', 'Notorious', 'Ruthless', 'Infamous'];
  const BOUNTY_REWARD_GOLD_BY_TIER = [80, 160, 280, 450];

  // Uses the same bandit-gang-config speciesWeights as the actual roster.
  // This helper lives here only because bounty creation happens before any
  // entity exists; no species probabilities are duplicated in code.
  function _weightedSpeciesPick(weights) {
    const entries = Object.entries(weights || {}).filter(([key, value]) => !key.startsWith('_') && Number(value) > 0);
    if (!entries.length) return null;
    const total = entries.reduce((sum, [, value]) => sum + Number(value), 0);
    let roll = Math.random() * total;
    for (const [speciesId, value] of entries) {
      roll -= Number(value);
      if (roll <= 0) return speciesId;
    }
    return entries[entries.length - 1][0];
  }

  function _campRecordForSpawn(opts) {
    const instanceId = opts?.extra?.banditCampInstanceId; // Used to annotate the exact camp record after its captain is generated.
    if (!instanceId || !opts?.zoneId) return null;
    return (window.BanditCamps?.campInstances?.get(opts.zoneId) || []).find(rec => rec.instance?.id === instanceId) || null;
  }

  function _annotateCampCaptain(opts, identity) {
    const rec = _campRecordForSpawn(opts); // Persists live-captain identity so later bounty adoption survives a reload correctly.
    if (!rec || !identity) return;
    rec.captainSpeciesId = identity.speciesId;
    rec.captainGender = identity.gender;
    rec.captainNameSeed = identity.seed || null;
  }

  function _discardRejectedCaptain(candidate) {
    // A rejected gender sample has not entered hostileObjects/camp gangIds yet;
    // only makeEntity's scene-side avatar/tool/shadow need detaching.
    candidate?.avatarRef?.group?.removeFromParent?.();
    candidate?.avatarRef?.dispose?.();
    candidate?._banditToolHolder?.removeFromParent?.();
    candidate?.groundShadow?.removeFromParent?.();
  }

  // Installs the captain-only naming/appearance adapter around the existing
  // combat module. Ordinary bandit roster/combat generation stays untouched.
  function _installCaptainNameForgeAdapter() {
    const combat = window.BanditCombat;
    const forge = window.BanditNameForge;
    if (!combat?.makeEntity || !forge || combat.__captainNameForgeAdapterInstalled) return;
    const originalMakeEntity = combat.makeEntity; // Called for every real entity after any bounty appearance pin is prepared.
    const originalRandomName = combat.randomName; // Preserved for non-captain callers.

    combat.makeEntity = async function(cfg, rank, tier, x, y, opts = {}) {
      const bountyPin = rank === 'captain' && opts.nameOverride && opts.zoneId
        ? window.BountyBoard?.activeBountyForZone?.(opts.zoneId)
        : null; // Used below to force the already-posted captain's appearance as well as their name.
      const desiredSpecies = bountyPin?.captainSpeciesId;
      const desiredGender = bountyPin?.captainGender;
      let captain = null; // Holds the accepted generated captain returned to bandit-camps.

      if (desiredSpecies && (desiredGender === 'male' || desiredGender === 'female')) {
        const forcedCfg = { ...cfg, speciesWeights: { [desiredSpecies]: 1 } }; // Forces species through the roster's existing weighted picker.
        const MAX_GENDER_ATTEMPTS = 24;
        for (let attempt = 1; attempt <= MAX_GENDER_ATTEMPTS; attempt++) {
          const candidate = await originalMakeEntity.call(combat, forcedCfg, rank, tier, x, y, opts); // Reuses the normal roster/avatar pipeline; only mismatched gender samples are rejected.
          if (!candidate) return null;
          if (candidate.rosterRecord?.appearance?.gender === desiredGender) {
            captain = candidate;
            if (attempt > 1) deps?.debugLog?.(`[bandits] bounty captain gender pin matched after ${attempt} roster rolls (${desiredSpecies}/${desiredGender}).`, 'info');
            break;
          }
          if (attempt === MAX_GENDER_ATTEMPTS) {
            captain = candidate;
            deps?.debugLog?.(`[bandits] bounty captain gender pin exhausted ${MAX_GENDER_ATTEMPTS} rolls; using generated ${candidate.rosterRecord?.appearance?.gender || 'unknown'} appearance.`, 'warn');
            break;
          }
          _discardRejectedCaptain(candidate);
        }
      } else {
        captain = await originalMakeEntity.call(combat, cfg, rank, tier, x, y, opts);
      }

      if (!captain || rank !== 'captain') return captain;

      if (opts.nameOverride) {
        const pinnedIdentity = {
          speciesId: desiredSpecies || captain.rosterRecord?.appearance?.speciesId,
          gender: desiredGender || captain.rosterRecord?.appearance?.gender,
          seed: bountyPin?.captainNameSeed || null,
          display: opts.nameOverride,
          name: opts.nameOverride,
        }; // Stored on the live entity/camp for debugging and later bounty adoption.
        captain.banditCaptainIdentity = pinnedIdentity;
        if (captain.rosterRecord) captain.rosterRecord.nameForge = pinnedIdentity;
        _annotateCampCaptain(opts, pinnedIdentity);
        return captain;
      }

      try {
        const speciesId = captain.rosterRecord?.appearance?.speciesId;
        const gender = captain.rosterRecord?.appearance?.gender;
        const identity = forge.generateCaptainIdentity({
          speciesId,
          gender,
          seed: `live-captain:${opts.zoneId || captain.areaId || 'unknown'}:${captain.id}`,
        });
        captain.name = identity.display;
        captain.banditCaptainIdentity = identity;
        if (captain.rosterRecord) {
          captain.rosterRecord.name = identity.display;
          captain.rosterRecord.nameForge = identity;
        }
        _annotateCampCaptain(opts, identity);
        deps?.debugLog?.(`[bandits] forged captain name ${identity.display} (${speciesId}/${gender})`, 'info');
      } catch (error) {
        deps?.debugLog?.(`[bandits] captain name forge failed; keeping fallback "${captain.name}": ${error.message}`, 'warn');
      }
      return captain;
    };

    // Kept for compatibility with any standalone caller; bounty posting itself
    // no longer needs this path because it now preselects a full identity.
    combat.randomName = function(rank) {
      if (rank !== 'captain') return originalRandomName?.call(combat, rank);
      return forge.generateNicknameOnly().display;
    };

    combat.__captainNameForgeAdapterInstalled = true;
  }
  _installCaptainNameForgeAdapter();

  function _zoneHasAnyBounty(zoneId) {
    return Object.values(deps.getQuestProgress()).some(st =>
      st.progress?.kind === 'bounty' && st.progress.zoneId === zoneId
      && (st.status === 'posted' || st.status === 'available'));
  }

  // The promised bounty for this zone, accepted OR still posted. Bandit camps
  // use this to pin a freshly generated captain, so a poster cannot silently
  // become stale just because the player entered that wilderness before
  // pressing Take Bounty.
  function _activeBountyForZone(zoneId) {
    for (const [id, st] of Object.entries(deps.getQuestProgress())) {
      if (st.progress?.kind === 'bounty' && st.progress.zoneId === zoneId
          && (st.status === 'posted' || st.status === 'available')) {
        return { id, ...st.progress };
      }
    }
    return null;
  }

  function hasActiveBounty() {
    return Object.values(deps.getQuestProgress()).some(st => st.progress?.kind === 'bounty' && (st.status === 'posted' || st.status === 'available'));
  }

  function getCurrentBountyPosting() {
    const entries = Object.entries(deps.getQuestProgress()).filter(([, st]) => st.progress?.kind === 'bounty' && st.status === 'posted');
    entries.sort((a, b) => (b[1].progress.postedDay || 0) - (a[1].progress.postedDay || 0));
    return entries[0] ? { id: entries[0][0], ...entries[0][1].progress } : null;
  }

  async function maybeRefreshBountyPosting() {
    if (hasActiveBounty()) return;
    const cfg = await _loadBanditGangConfig(); // Required before inventing a future captain so the poster uses the real configured species weights.
    if (hasActiveBounty()) return; // Another path may have posted one while the config request was in flight.
    generateBountyTask(cfg);
  }

  // Prefers a real live captain when one exists. Otherwise the bounty now
  // preselects species + gender first and asks the forge for a FULL cultural
  // name (nickname-only chance forced to zero), then persists that appearance
  // so the future camp can create exactly the person named on the poster.
  function generateBountyTask(cfg) {
    const liveCandidates = [];
    for (const [zoneId, recs] of window.BanditCamps.campInstances) {
      if (_zoneHasAnyBounty(zoneId)) continue;
      for (const rec of recs) {
        if (rec.captainName && !window.BanditCamps.isCampCleared(rec)) {
          liveCandidates.push({
            zoneId,
            tier: rec.tier,
            captainName: rec.captainName,
            captainSpeciesId: rec.captainSpeciesId || null,
            captainGender: rec.captainGender || null,
            captainNameSeed: rec.captainNameSeed || null,
          });
        }
      }
    }

    let target;
    if (liveCandidates.length) {
      target = liveCandidates[Math.floor(Math.random() * liveCandidates.length)];
    } else {
      const forge = window.BanditNameForge;
      if (!forge || !cfg) {
        deps.debugLog?.('Cannot post a bounty because the captain name forge or gang config is unavailable.', 'warn');
        return null;
      }
      const zoneIds = Object.keys(deps.WMAP_ZONE_LABELS).filter(zoneId => !_zoneHasAnyBounty(zoneId));
      if (!zoneIds.length) return null;
      const speciesId = _weightedSpeciesPick(cfg.speciesWeights) || 'mao-ao'; // Used immediately to choose the correct culture-specific name rules.
      const seedRecord = forge.generateNicknameOnly(); // Supplies a fresh forge seed; its nickname output itself is intentionally discarded.
      const identity = forge.generateCaptainIdentity({ speciesId, seed: seedRecord.seed, nicknameOnlyChance: 0 }); // Chooses gender deterministically from the seed and always includes the full cultural name.
      const zoneId = zoneIds[Math.floor(Math.random() * zoneIds.length)];
      target = {
        zoneId,
        tier: Math.floor(Math.random() * BOUNTY_RANK_LABELS.length),
        captainName: identity.display,
        captainSpeciesId: identity.speciesId,
        captainGender: identity.gender,
        captainNameSeed: identity.seed,
      };
    }

    const id = deps.makeTaskId();
    const task = {
      kind: 'bounty',
      captainName: target.captainName,
      captainSpeciesId: target.captainSpeciesId || null,
      captainGender: target.captainGender || null,
      captainNameSeed: target.captainNameSeed || null,
      zoneId: target.zoneId,
      tier: target.tier,
      rewardGold: BOUNTY_REWARD_GOLD_BY_TIER[target.tier],
      postedDay: deps.calendar.day,
    };
    deps.setQuestStatus(id, 'posted', task);
    return { id, ...task };
  }

  function takeBountyTask(taskId) {
    const st = deps.getQuestProgress()[taskId];
    if (!st || st.status !== 'posted' || st.progress?.kind !== 'bounty') return { ok: false, message: 'That bounty is no longer available.' };
    deps.setQuestStatus(taskId, 'available', {});
    deps.showToast(`🎯 Bounty accepted — hunt down ${st.progress.captainName} and destroy their camp.`, true);
    updateBountyTracking();
    return { ok: true, message: 'Bounty added to your log.' };
  }

  const _bountyMarkers = new Map(); // key: bounty taskId -> { zoneId, col, row, label }, consumed by map/minimap rendering.
  const BOUNTY_TRACKING_CHECK_INTERVAL_S = 1;
  let _bountyTrackingAccum = 0;

  function updateBountyTracking(dt) {
    if (dt != null) {
      _bountyTrackingAccum += dt;
      if (_bountyTrackingAccum < BOUNTY_TRACKING_CHECK_INTERVAL_S) return;
      _bountyTrackingAccum = 0;
    }
    for (const [id, st] of Object.entries(deps.getQuestProgress())) {
      if (st.progress?.kind !== 'bounty') continue;
      if (st.status !== 'available') { _bountyMarkers.delete(id); continue; }
      const bounty = st.progress;
      const rec = (window.BanditCamps.campInstances.get(bounty.zoneId) || []).find(r => r.captainName === bounty.captainName);
      if (!rec) continue;
      if (window.BanditCamps.isCampCleared(rec)) {
        deps.setQuestStatus(id, 'completed', {});
        deps.inventory.gold = (deps.inventory.gold || 0) + bounty.rewardGold;
        deps.showToast(`🎯 Bounty complete! ${bounty.captainName}'s camp is destroyed. +${bounty.rewardGold}g`, true);
        _bountyMarkers.delete(id);
        continue;
      }
      _bountyMarkers.set(id, {
        zoneId: bounty.zoneId,
        col: rec.instance.site.x + rec.instance.site.w / 2,
        row: rec.instance.site.y + rec.instance.site.h / 2,
        label: bounty.captainName,
      });
    }
  }

  // Emits representative generated names into the existing on-screen debug log; useful on mobile without DevTools.
  function debugCaptainNames(perSpecies = 2) {
    const forge = window.BanditNameForge;
    if (!forge) {
      const message = 'Bandit captain name forge is unavailable.';
      deps?.debugLog?.(message, 'warn');
      return message;
    }
    const report = forge.debugSampleText(perSpecies);
    deps?.debugLog?.(`Bandit captain name samples:\n${report}`, 'info');
    return report;
  }

  window.BountyBoard = {
    init,
    RANK_LABELS: BOUNTY_RANK_LABELS,
    getCurrentPosting: getCurrentBountyPosting,
    maybeRefreshPosting: maybeRefreshBountyPosting,
    take: takeBountyTask,
    updateTracking: updateBountyTracking,
    activeBountyForZone: _activeBountyForZone,
    debugCaptainNames,
    get markers() { return _bountyMarkers; },
  };
})();
