'use strict';

const DEMO_DB = {
  schema:'hobunji_npc_database.v2',
  npcs:[
    {
      id:'demo_aliri',name:'Aliri Ginji',role:'researcher',species:'Mao’ao',
      dialogueTrees:[
        makeDemoTree('general','General Greeting','interact',0,{},[
          {id:'g0',type:'text',text:'A general greeting with no required conditions.',next:'g1'},
          {id:'g1',type:'choice',choices:[{label:'Ask about today',next:'g2'},{label:'Say goodbye',next:'g3'}]},
          {id:'g2',type:'text',text:'The answer can branch back into another line.',next:'g3'},
          {id:'g3',type:'end'}
        ],'g0'),
        makeDemoTree('first','First Meeting','interact',7,{encounter:['first']},[
          {id:'f0',type:'text',text:'Oh! I do not believe we have met.',next:'f1'},
          {id:'f1',type:'choice',choices:[{label:'Introduce yourself',next:'f2'},{label:'Remain mysterious',next:'f3'}]},
          {id:'f2',type:'text',text:'A warmer introduction response.',next:'f4'},
          {id:'f3',type:'text',text:'A suspicious but amused response.',next:'f4'},
          {id:'f4',type:'end'}
        ],'f0'),
        makeDemoTree('returning','Returning Visitor','interact',3,{encounter:['returning']},[
          {id:'r0',type:'sequence',slots:[{nodeId:'r1',depth:0},{nodeId:'r2',depth:0},{nodeId:'r3',depth:1}],next:'r4',exhaustedNext:'r5'},
          {id:'r1',type:'text',text:'Back again?',next:'r4'},
          {id:'r2',type:'text',text:'I wondered when you would return.',next:'r4'},
          {id:'r3',type:'text',text:'You are becoming a familiar sight.',next:'r4'},
          {id:'r4',type:'end'},{id:'r5',type:'text',text:'I am out of new greetings for today.',next:'r4'}
        ],'r0'),
        makeDemoTree('rain','Rainy Day','interact',4,{weather:['rain'],timesOfDay:['day']},[
          {id:'rd0',type:'text',text:'The rain changes what everyone is willing to talk about.',next:'rd1'},
          {id:'rd1',type:'end'}
        ],'rd0'),
        makeDemoTree('rainnight','Rainy Night','interact',8,{weather:['rain'],timesOfDay:['night']},[
          {id:'rn0',type:'text',text:'Rain after dark deserves its own, more specific tree.',next:'rn1'},
          {id:'rn1',type:'choice',choices:[{label:'Listen to the rain',next:'rn2'},{label:'Head home',next:'rn3'}]},
          {id:'rn2',type:'text',text:'A small atmospheric response.',next:'rn3'},
          {id:'rn3',type:'end'}
        ],'rn0'),
        makeDemoTree('dawnmarket','Dawn at the Market','interact',5,{timesOfDay:['dawn'],maps:['map_hobunji_town'],stations:['Market Stall']},[
          {id:'dm0',type:'text',text:'You found me before the market properly opened.',next:'dm1'},
          {id:'dm1',type:'end'}
        ],'dm0'),
        makeDemoTree('closefriend','Close Friend Check-in','relationship',9,{relationship:{min:7,max:null}},[
          {id:'cf0',type:'text',text:'A personal line available only at high relationship.',next:'cf1'},
          {id:'cf1',type:'choice',choices:[{label:'Offer help',next:'cf2'},{label:'Change the subject',next:'cf3'}]},
          {id:'cf2',type:'text',text:'Thank you. I may actually take you up on that.',next:'cf4'},
          {id:'cf3',type:'text',text:'Another time, then.',next:'cf4'},
          {id:'cf4',type:'end'}
        ],'cf0'),
        makeDemoTree('stormcold','Coldmuck Storm','interact',10,{seasons:['Coldmuck'],weather:['storm']},[
          {id:'cs0',type:'text',text:'The most specific environmental interruption wins.',next:'cs1'},
          {id:'cs1',type:'end'}
        ],'cs0'),
        makeDemoTree('species','Kenkari Visitor','interact',4,{playerSpecies:['kenkari']},[
          {id:'sp0',type:'text',text:'A player-species-specific observation.',next:'sp1'},
          {id:'sp1',type:'end'}
        ],'sp0'),
        makeDemoTree('weekend','Tothu or Uung Routine','interact',2,{weekdays:['Tothu','Uung'],timesOfDay:['dusk']},[
          {id:'wk0',type:'text',text:'A tree with multiple values on one axis tests branch duplication.',next:'wk1'},
          {id:'wk1',type:'end'}
        ],'wk0')
      ]
    },
    {
      id:'demo_binding',name:'Binding Hatayap',role:'craftsperson',species:'Tletingan',
      dialogueTrees:[
        makeDemoTree('bgen','Workshop Greeting','interact',0,{maps:['map_hobunji_town'],stations:['Carpentry Work']},[
          {id:'b0',type:'text',text:'Careful where you put your hands.',next:'b1'},{id:'b1',type:'end'}
        ],'b0'),
        makeDemoTree('bgift','Gift Response','gift',6,{relationship:{min:3,max:null}},[
          {id:'bg0',type:'text',text:'This is useful. You paid attention.',next:'bg1'},{id:'bg1',type:'end'}
        ],'bg0'),
        makeDemoTree('bnight','Late Workshop','interact',4,{timesOfDay:['night'],stations:['Carpentry Work']},[
          {id:'bn0',type:'text',text:'The workshop should be closed, technically.',next:'bn1'},{id:'bn1',type:'end'}
        ],'bn0'),
        makeDemoTree('bstorm','Storm Repair','custom',12,{weather:['storm'],maps:['map_hobunji_town']},[
          {id:'bs0',type:'sequence',slots:[{nodeId:'bs1',depth:0},{nodeId:'bs2',depth:0}],next:'bs3',exhaustedNext:'bs4'},
          {id:'bs1',type:'text',text:'Check the shutters.',next:'bs3'},
          {id:'bs2',type:'text',text:'Bring the loose boards inside.',next:'bs3'},
          {id:'bs3',type:'end'},{id:'bs4',type:'text',text:'We have covered everything.',next:'bs3'}
        ],'bs0')
      ]
    }
  ]
};

function makeDemoTree(id,label,trigger,priority,conditions,nodes,entryNode){
  return {id,label,trigger,priority,conditions:normalizeConditions(conditions),excludeConditions:normalizeConditions({}),nodes,entryNode};
}
function normalizeConditions(c){
  if(window.ConditionRegistry?.normalizeConditions)return window.ConditionRegistry.normalizeConditions(c||{});
  c=c||{};
  return {
    weekdays:Array.isArray(c.weekdays)?c.weekdays:[],seasons:Array.isArray(c.seasons)?c.seasons:[],weather:Array.isArray(c.weather)?c.weather:[],timesOfDay:Array.isArray(c.timesOfDay)?c.timesOfDay:[],encounter:Array.isArray(c.encounter)?c.encounter:[],maps:Array.isArray(c.maps)?c.maps:[],stations:Array.isArray(c.stations)?c.stations:[],playerSpecies:Array.isArray(c.playerSpecies)?c.playerSpecies:[],relationship:{min:c.relationship?.min??null,max:c.relationship?.max??null}
  };
}
function emptyConditions(){return window.ConditionRegistry?.emptyConditions?window.ConditionRegistry.emptyConditions():normalizeConditions({})}

const DIMENSIONS = [
  {key:'trigger',label:'Trigger',values:t=>[t.trigger||'interact']},
  {key:'encounter',label:'Encounter',values:t=>axisValues(t,'encounter')},
  {key:'relationship',label:'Relationship',values:t=>relationshipValues(t)},
  {key:'location',label:'Location',values:t=>locationValues(t)},
  {key:'season',label:'Season',values:t=>axisValues(t,'seasons')},
  {key:'weather',label:'Weather',values:t=>axisValues(t,'weather')},
  {key:'time',label:'Time of day',values:t=>axisValues(t,'timesOfDay')},
  {key:'weekday',label:'Weekday',values:t=>axisValues(t,'weekdays')},
  {key:'species',label:'Player species',values:t=>axisValues(t,'playerSpecies')},
  {key:'priority',label:'Priority band',values:t=>[priorityBand(t.priority||0)]},
  {key:'specificity',label:'Specificity',values:t=>[specificityBand(treeSpecificity(t))]}
];
const DIM_BY_KEY=Object.fromEntries(DIMENSIONS.map(d=>[d.key,d]));
function axisValues(tree,key){return normalizeConditions(tree.conditions)[key]||[]}
function relationshipValues(tree){
  const r=normalizeConditions(tree.conditions).relationship;
  if(r.min==null&&r.max==null)return[];
  if(r.min!=null&&r.max!=null)return [`${r.min}–${r.max} hearts`];
  if(r.min!=null)return [r.min>=7?'Close friend':r.min>=3?'Friend+':`${r.min}+ hearts`];
  return [`Up to ${r.max} hearts`];
}
function locationValues(tree){
  const c=normalizeConditions(tree.conditions);
  if(c.stations.length)return c.stations.map(v=>`Station · ${v}`);
  if(c.maps.length)return c.maps.map(v=>`Map · ${friendly(v)}`);
  return[];
}
function priorityBand(p){return p>=9?'Critical 9+':p>=5?'High 5–8':p>=1?'Normal 1–4':'Fallback 0'}
function specificityBand(n){return n>=4?'Highly specific (4+)':n>=2?'Contextual (2–3)':n===1?'Single condition':'General'}
function treeSpecificity(tree){
  const c=normalizeConditions(tree.conditions);let n=0;
  ['weekdays','seasons','weather','timesOfDay','encounter','maps','stations','playerSpecies'].forEach(k=>{if(c[k].length)n++});
  if(c.relationship.min!=null||c.relationship.max!=null)n++;
  return n;
}
function friendly(v){return String(v||'').replace(/^map_/,'').replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase())}
