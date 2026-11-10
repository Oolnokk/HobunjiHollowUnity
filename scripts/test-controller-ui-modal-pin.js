'use strict';

// A data-ctrl-modal panel (the day review) must stay the controller's active panel when another panel opens later
// (e.g. a dialogue/cutscene box), including when that panel explicitly asks for focus.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip: playwright is not installed (browser-only test)'); // CI's regression job installs no browser dependencies.
  process.exit(0);
}

const navSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'controller-ui-nav.js'), 'utf8'); // Shipped navigation module under test.
const festivalSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'festival-ui.js'), 'utf8'); // Uses the real offering menu, not a copied controller mock.

(async () => {
  const pinned = '/opt/pw-browsers/chromium'; // Sandbox-provided Chromium; other environments use Playwright's own.
  const browser = await chromium.launch(fs.existsSync(pinned) ? { executablePath: pinned } : {});
  try {
    const page = await browser.newPage();
    await page.setContent('<body></body>');
    await page.addScriptTag({ content: navSource });
    const result = await page.evaluate(async () => {
      const make = (id, modal) => {
        const el = document.createElement('div');
        el.id = id;
        el.setAttribute('data-ctrl-panel', '');
        if (modal) el.setAttribute('data-ctrl-modal', '');
        el.style.cssText = 'width:100px;height:100px';
        el.innerHTML = '<button>x</button>';
        document.body.appendChild(el);
        return el;
      };
      const review = make('review', true);
      window.ControllerUI.focusPanel(review);
      const dialogue = make('dialogue', false);
      await new Promise(resolve => setTimeout(resolve, 150));
      const afterOpen = window.ControllerUI.activePanel()?.id;
      window.ControllerUI.focusPanel(dialogue);
      const afterFocusTheft = window.ControllerUI.activePanel()?.id;
      review.remove();
      await new Promise(resolve => setTimeout(resolve, 150));
      return { afterOpen, afterFocusTheft, afterClose: window.ControllerUI.activePanel()?.id };
    });
    assert.equal(result.afterOpen, 'review', 'a panel opening later does not take the stack top from the modal');
    assert.equal(result.afterFocusTheft, 'review', 'explicit focusPanel from another panel is refused while the modal is up');
    assert.equal(result.afterClose, 'dialogue', 'focus falls back to the other panel once the modal closes');

    // Full production controller navigator + the real dynamically-rendered festival offering menu.
    const festivalPage = await browser.newPage({ viewport: { width: 900, height: 560 } });
    await festivalPage.setContent('<body></body>');
    await festivalPage.evaluate(() => {
      const firstGene = JSON.stringify({ base:{ color:'#aabbcc' },stripe:{ copies:1,carrier:true },sizeClass:'small' }); // Hidden carriers must stay unique.
      const otherGene = JSON.stringify({ base:{ color:'#ddeeff' },stripe:{ copies:2,carrier:false },sizeClass:'medium' }); // Second real bloodline.
      window.__offeringTest={ firstGene,otherGene,offered:false,performed:[],locks:0,releases:0 }; // Records the exact committed animal and lock release without a console.
      const state=window.__offeringTest; // Used by the isolated festival stub to expose only the expected public APIs.
      const feast={id:'tzizkhanash',name:'Tzizkhanash',icon:'🕯️',color:'#dbc296'}; // Same public event record the actual UI expects.
      window.FestivalCalendar={ activityLabels:{offering:'Ancestor offering'},blessings:{
        breedingFortune:{icon:'🐣',label:'Kindred Fortune',perLevel:.12,unit:'weight',description:'Breeding mutations',target:'Breeding livestock'},
        treasureFortune:{icon:'🔮',label:"Seeker's Fortune",perLevel:.09,unit:'weight',description:'Treasure chance',target:'Treasure caches'},
      }};
      window.CalendarSystem={formatCalendarDate:()=> 'Firstfall 22, 1156'};
      window.CharacterActionLocks={acquire:()=>{state.locks++;return {release:()=>state.releases++};}};
      window.FestivalSystem={
        festival:()=>feast,year:()=>1156,festivalHours:()=>true,gatheringHoursLabel:()=> '15:00–01:00',
        atProp:()=>true,claimed:()=>state.offered,
        qualityChoices:()=> [
          {key:'grehlrBaby',stars:2,count:1,label:'Grehlr Baby',icon:'🐈',category:'breedingFortune',variant:firstGene,traitSummary:'Small size · hidden stripe carrier',sharedQuality:true},
          {key:'grehlrBaby',stars:2,count:2,label:'Grehlr Baby',icon:'🐈',category:'breedingFortune',variant:otherGene,traitSummary:'Medium size · striped',sharedQuality:true},
          {key:'carving',stars:5,count:1,label:'Ancestor carving',icon:'🪨',category:'treasureFortune'},
        ],
        offeringPreview:(key,stars,variant)=> key && stars>=1 ? ({
          stat:key==='grehlrBaby'?'breedingFortune':'treasureFortune',level:2,mode:key==='grehlrBaby'?'release':'burn',
          statement:key==='grehlrBaby'?'Return this exact animal to the wild.':'Burn this ancestral keepsake.',
          qualityUnits:1.5,scarcityFactor:1.2,valueFactor:1.1,effortFactor:1,traitFactor:variant?1.2:1,
          sourceLabel:'Recorded lineage',confidence:'modeled',
        }):null,
        perform:(_type,payload)=>{state.performed.push(payload);state.offered=true;return {ok:true,message:'Fortune granted'};},
        diagnostics:()=>({festival:'tzizkhanash'}),
      };
      window.__offeringAnchor={id:'ancestor-shrine',activity:{type:'offering',label:'Ancestor offering'}};
    });
    await festivalPage.addScriptTag({content:navSource});
    await festivalPage.addScriptTag({content:festivalSource});
    const offering = await festivalPage.evaluate(async () => {
      const sleep=()=>new Promise(resolve=>setTimeout(resolve,70)); // Allows production MutationObserver ownership reconciliation between real DOM transitions.
      const anchor=window.__offeringAnchor,ui=window.ControllerUI;
      window.FestivalUI.open(anchor);
      await sleep();
      const root=document.getElementById('festivalDialog'); // Shared modal root inspected through the same selector as the existing game.
      const originalCards=[...root.querySelectorAll('.festival-offering-choice')]; // Used to verify a selection never destroys controller focus anchors.
      const first=originalCards[0],second=originalCards[1];
      const groups=[...root.querySelectorAll('.festival-offering-group')];
      const initial={panel:ui.activePanel()?.id,focus:ui.focusedElement()?.id,groups:groups.length,cards:originalCards.length};
      const edit=root.querySelector('[data-offering-filter]'); // Touch search must still work without stealing the gamepad navigation target.
      edit.value='carrier';edit.dispatchEvent(new Event('input',{bubbles:true}));
      const searchFiltered={visible:window.FestivalUI.diagnostics().lastVisibleCount,
        builds:window.FestivalUI.diagnostics().listBuilds};
      edit.value='';edit.dispatchEvent(new Event('input',{bubbles:true}));
      ui.press('confirm'); // A enters Kindred Fortune category.
      const category={depth:ui.debugState().groupDepth,focused:ui.focusedElement()===first};
      ui.press('confirm'); // A previews the selected exact genotype and automatically enters details.
      const detail={depth:ui.debugState().groupDepth,focusedAction:ui.focusedElement()?.dataset.festivalAction,
        confirmVisible:ui.debugState().focusedControlOnScreen,
        chosen:root.querySelector('.festival-offering-choice[aria-pressed="true"]')===first,
        sameCard:root.querySelectorAll('.festival-offering-choice')[0]===first,
        builds:window.FestivalUI.diagnostics().listBuilds,updated:window.FestivalUI.diagnostics().detailUpdates};
      ui.press('cancel'); // B returns to the same genotype-bearing card.
      const back={depth:ui.debugState().groupDepth,focusSame:ui.focusedElement()===first};
      ui.press('right'); // Different bloodlines remain distinct focusable neighbors.
      const switched=ui.focusedElement()===second;
      ui.press('confirm'); // A enters preview for second lineage.
      const secondPreview={depth:ui.debugState().groupDepth,
        picked:root.querySelector('.festival-offering-choice[aria-pressed="true"]')===second};
      ui.press('confirm'); // A commits the selected lineage through the ordinary perform handler.
      await sleep();
      const committed=window.__offeringTest.performed[0];
      window.__offeringTest.offered=false;
      window.FestivalUI.open(anchor);
      await sleep();
      const other=document.createElement('div');other.setAttribute('data-ctrl-panel','');other.style.cssText='width:200px;height:100px';
      other.innerHTML='<button>Other overlay</button>';document.body.appendChild(other);
      const takeover=ui.focusPanel(other); // Pinned festival modal must not lose A/B ownership.
      const stillOwner=ui.activePanel()?.id;
      root.querySelector('#festivalContent').insertAdjacentHTML('beforeend','<div style="height:1400px"></div>');
      root.querySelector('.festival-card').scrollTop=0; // The footer close button is deliberately hidden beneath the scroll clip.
      const footer=root.querySelector('[data-ctrl-cancel]');
      const box=root.querySelector('.festival-card').getBoundingClientRect();
      const closeClipped=footer.getBoundingClientRect().top>=box.bottom;
      ui.press('cancel'); // B must still close through the global Escape fallback.
      await sleep();
      return {initial,searchFiltered,category,detail,back,switched,secondPreview,
        committedKey:committed?.key,committedVariant:committed?.variant,expectedVariant:window.__offeringTest.otherGene,
        listBuilds:window.FestivalUI.diagnostics().listBuilds,takeover,stillOwner,closeClipped,
        closed:root.style.display==='none',locks:window.__offeringTest.locks,releases:window.__offeringTest.releases};
    });
    assert.equal(offering.initial.panel,'festivalDialog','the offering is the active controller modal');
    assert.equal(offering.initial.focus,'festival-offering-breedingFortune','controller starts at the fortune category rather than the search input');
    assert.equal(offering.initial.groups,2,'two independent fortune categories form controller groups');
    assert.equal(offering.initial.cards,3,'two genotypes and one keepsake are separately selectable');
    assert.equal(offering.searchFiltered.visible,1,'search narrows cards without regenerating the inventory list');
    assert.equal(offering.searchFiltered.builds,1,'search does not rebuild cards');
    assert.equal(offering.category.depth,1,'A enters the category once');
    assert.equal(offering.category.focused,true,'first category opens on an actual item');
    assert.equal(offering.detail.depth,2,'A on an item enters its confirmation panel');
    assert.equal(offering.detail.focusedAction,'perform','A focuses the confirmation button');
    assert.equal(offering.detail.confirmVisible,true,'the controller can activate the selected confirmation without manually scrolling to an offscreen button');
    assert.equal(offering.detail.chosen,true,'the highlighted genome is the selected one');
    assert.equal(offering.detail.sameCard,true,'item selection preserves the original DOM node');
    assert.equal(offering.detail.builds,1,'selecting an item never performs a full grid rebuild');
    assert(offering.detail.updated>1,'only the small fortune preview updates');
    assert.deepEqual(offering.back,{depth:1,focusSame:true},'B returns exactly to the chosen animal, including hidden carriers');
    assert.equal(offering.switched,true,'controller can change between different baby genotypes');
    assert.equal(offering.secondPreview.depth,2,'second selection also enters its own detail panel');
    assert.equal(offering.secondPreview.picked,true,'the second genotype is highlighted independently');
    assert.equal(offering.committedKey,'grehlrBaby');
    assert.equal(offering.committedVariant,offering.expectedVariant,'A confirms the second actual animal, not a merged generic stack');
    assert.equal(offering.takeover,false,'an unrelated opening panel cannot steal the festival controller');
    assert.equal(offering.stillOwner,'festivalDialog','festival retains top priority while open');
    assert.equal(offering.closeClipped,true,'long festival cards really clip the close button in this test');
    assert.equal(offering.closed,true,'B closes the festival even when its footer is off-screen');
    assert.equal(offering.locks,offering.releases,'each controller close/open releases its character action lock');
    await festivalPage.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
