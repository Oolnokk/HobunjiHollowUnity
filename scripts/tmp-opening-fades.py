from pathlib import Path
import json

runtime_path = Path('docs/js/loading-screen-runtime.js')
text = runtime_path.read_text()

old = """    const stageText = document.createElement('div'); // Authored opening pages can reveal later lines while the same black-screen page remains active.\n    const percentText = document.createElement('div'); // Quiet progress stays at the bottom, separate from centered story copy.\n"""
new = """    const INTRO_FADE_MS = 900; // Used by narrative pages and Continue prompts so every opening-text change crossfades instead of snapping.\n    const MIN_STORY_BEAT_SECONDS = 8; // Used as the hard floor between opening narration changes, including delayed reveals and Continue availability.\n    const stageText = document.createElement('div'); // Authored opening pages keep delayed lines laid out invisibly until their fade-in beat.\n    stageText.style.cssText = `opacity:0;transition:opacity ${INTRO_FADE_MS}ms ease`;\n    const percentText = document.createElement('div'); // Quiet progress stays at the bottom, separate from centered story copy.\n"""
if old not in text:
    raise SystemExit('stageText setup target not found')
text = text.replace(old, new, 1)

old = "continueButton.style.cssText = 'position:absolute;bottom:12vh;min-height:48px;padding:10px 20px;background:transparent;color:#fff;border:0;font:18px KhymeryyanRoman,serif;cursor:pointer;visibility:hidden';"
new = "continueButton.style.cssText = `position:absolute;bottom:12vh;min-height:48px;padding:10px 20px;background:transparent;color:#fff;border:0;font:18px KhymeryyanRoman,serif;cursor:pointer;opacity:0;pointer-events:none;transition:opacity ${INTRO_FADE_MS}ms ease`;"
if old not in text:
    raise SystemExit('continue style target not found')
text = text.replace(old, new, 1)
text = text.replace("    let renderedCopy = ''; // Accumulates delayed authored text before re-rendering lightweight **bold** spans.\n", '', 1)

start = text.index('    const renderCopy = value => {')
end = text.index('    const accept = event => {', start)
replacement = r'''    const appendRichText = (container, value) => {
      const copy = String(value || '');
      if (!copy.includes('**') || typeof document.createTextNode !== 'function') { container.textContent = copy.replace(/\*\*/g, ''); return; }
      let cursor = 0;
      for (const match of copy.matchAll(/\*\*(.+?)\*\*/gs)) {
        if (match.index > cursor) container.appendChild(document.createTextNode(copy.slice(cursor, match.index)));
        const strong = document.createElement('strong'); // Used by authored opening copy such as “only the lost may find.”
        strong.textContent = match[1];
        container.appendChild(strong);
        cursor = match.index + match[0].length;
      }
      if (cursor < copy.length) container.appendChild(document.createTextNode(copy.slice(cursor)));
    };
    const fadeTo = (element, opacity, durationMs = INTRO_FADE_MS) => {
      element.style.opacity = String(opacity);
      if (durationMs <= 0 || typeof setTimeout !== 'function') return Promise.resolve();
      return new Promise(resolve => setTimeout(resolve, durationMs));
    };
    const renderPageCopy = page => {
      stageText.innerHTML = '';
      const base = document.createElement('span'); // The base copy stays visible while delayed spans already occupy their final layout space.
      appendRichText(base, page?.text || '');
      stageText.appendChild(base);
      const delayed = [];
      for (const reveal of Array.isArray(page?.delayedReveals) ? page.delayedReveals : []) {
        const node = document.createElement('span'); // Opacity zero preserves the final page geometry so delayed copy never shifts the centered composition.
        node.style.cssText = `opacity:0;transition:opacity ${INTRO_FADE_MS}ms ease`;
        node.setAttribute?.('aria-hidden', 'true');
        appendRichText(node, reveal?.text || '');
        stageText.appendChild(node);
        delayed.push({ reveal, node });
      }
      return delayed;
    };
    const showPage = page => {
      clearPageTimers();
      startedAt = nowMs();
      ready = false;
      const delayed = renderPageCopy(page);
      stageText.style.opacity = '0';
      void stageText.offsetWidth; // Force the hidden first frame so assigning opacity 1 below reliably animates on mobile browsers.
      stageText.style.opacity = '1';
      continueButton.disabled = true;
      continueButton.style.opacity = '0';
      continueButton.style.pointerEvents = 'none';
      continueButton.setAttribute?.('aria-hidden', 'true');
      for (const { reveal, node } of delayed) {
        const delaySeconds = Math.max(MIN_STORY_BEAT_SECONDS, Number(reveal?.afterSeconds) || 0);
        const timer = setTimeout(() => {
          if (cancelled) return;
          node.setAttribute?.('aria-hidden', 'false');
          node.style.opacity = '1';
        }, delaySeconds * 1000);
        pageTimers.push(timer);
      }
      state.introductionStage = stageIndex + 1;
      root.focus?.({ preventScroll: true });
    };
'''
text = text[:start] + replacement + text[end:]

old = """      ready = false;\n      continueButton.disabled = true;\n      continueButton.style.visibility = 'hidden';\n      const resolve = continueStage; continueStage = null; rejectStage = null; resolve(); // Consume this input exactly once.\n"""
new = """      ready = false;\n      continueButton.disabled = true;\n      continueButton.style.pointerEvents = 'none';\n      continueButton.setAttribute?.('aria-hidden', 'true');\n      clearPageTimers();\n      const resolve = continueStage; continueStage = null; rejectStage = null;\n      Promise.all([fadeTo(continueButton, 0), fadeTo(stageText, 0)]).then(resolve); // Let both prompt and current page finish fading out before the next page can replace their text.\n"""
if old not in text:
    raise SystemExit('accept target not found')
text = text.replace(old, new, 1)

old = """      const delayedTail = Math.max(0, ...(Array.isArray(page?.delayedReveals) ? page.delayedReveals.map(reveal => Number(reveal?.afterSeconds) || 0) : [0])); // Never show Continue before the last delayed line exists.\n      const minimumSeconds = Math.max(delayedTail, Number(page?.minimumSeconds) || Number(stages[stageIndex]?.minimumSeconds) || 0);\n      const minimum = minimumSeconds * 1000;\n"""
new = """      const authoredReveals = Array.isArray(page?.delayedReveals) ? page.delayedReveals : [];\n      const delayedTail = Math.max(0, ...authoredReveals.map(reveal => Math.max(MIN_STORY_BEAT_SECONDS, Number(reveal?.afterSeconds) || 0))); // Every delayed line waits at least eight seconds before beginning its fade.\n      const authoredMinimum = Math.max(MIN_STORY_BEAT_SECONDS, Number(page?.minimumSeconds) || Number(stages[stageIndex]?.minimumSeconds) || 0);\n      const minimumSeconds = delayedTail > 0 ? Math.max(authoredMinimum, delayedTail + MIN_STORY_BEAT_SECONDS) : authoredMinimum; // Continue waits another full beat after the final delayed line instead of appearing alongside it.\n      const minimum = minimumSeconds * 1000;\n"""
if old not in text:
    raise SystemExit('minimum timing target not found')
text = text.replace(old, new, 1)

old = """        continueStage = resolve; rejectStage = reject; ready = true; // Earlier taps are discarded; a fresh input is required for each visible page.\n        continueButton.disabled = false;\n        continueButton.style.visibility = 'visible';\n        continueButton.focus?.({ preventScroll: true });\n"""
new = """        continueStage = resolve; rejectStage = reject; ready = true; // Earlier taps are discarded; a fresh input is required for each visible page.\n        continueButton.disabled = false;\n        continueButton.style.pointerEvents = 'auto';\n        continueButton.setAttribute?.('aria-hidden', 'false');\n        continueButton.style.opacity = '1';\n        continueButton.focus?.({ preventScroll: true });\n"""
if old not in text:
    raise SystemExit('continue reveal target not found')
text = text.replace(old, new, 1)

old = "latestChange: 'Opening loading phases now support multiple story pages, delayed line reveals and lightweight **bold** emphasis while preserving fresh-input gates and the final asset-readiness boundary.'"
new = "latestChange: 'Opening narration pages and Continue prompts now fade in/out; delayed lines occupy their final layout from page start, fade in after at least eight seconds, and Continue waits at least another eight seconds after the last delayed reveal.'"
if old not in text:
    raise SystemExit('debug summary target not found')
text = text.replace(old, new, 1)
runtime_path.write_text(text)

config_path = Path('docs/config/loading-screens.json')
data = json.loads(config_path.read_text())
data['version'] = max(7, int(data.get('version') or 0))
intro = next(entry for entry in data['entries'] if entry.get('id') == 'world-introduction')
for stage in intro['stages']:
    stage['minimumSeconds'] = max(8, float(stage.get('minimumSeconds') or 0))
    for page in stage.get('pages') or [stage]:
        reveals = page.get('delayedReveals') or []
        for reveal in reveals:
            reveal['afterSeconds'] = max(8, float(reveal.get('afterSeconds') or 0))
        minimum = max(8, float(page.get('minimumSeconds') or 0))
        if reveals:
            minimum = max(minimum, max(float(r['afterSeconds']) for r in reveals) + 8)
        if page.get('text') == 'that the greatest things in this world of ours':
            minimum = max(minimum, 18)  # Preserve the approved ten-second completed-maxim hold after its 8s reveal.
        page['minimumSeconds'] = minimum
config_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')

test_path = Path('scripts/test-introduction-loading-and-framing.js')
test = test_path.read_text()
test = test.replace("assert.equal(maximPage.delayedReveals?.[0]?.afterSeconds, 2.5);", "assert.equal(maximPage.delayedReveals?.[0]?.afterSeconds, 8);")
test = test.replace("assert(loader.includes('delayedReveals'), 'introduction runtime must preserve delayed line reveals');", """assert(loader.includes('delayedReveals'), 'introduction runtime must preserve delayed line reveals');
assert(storyPages.every(page => Number(page.minimumSeconds) >= 8), 'every visible opening page has an eight-second minimum beat');
assert(storyPages.flatMap(page => page.delayedReveals || []).every(reveal => Number(reveal.afterSeconds) >= 8), 'every delayed reveal waits at least eight seconds');
assert(loader.includes('const MIN_STORY_BEAT_SECONDS = 8'), 'runtime enforces the eight-second beat floor even for future authored pages');
assert(loader.includes('transition:opacity ${INTRO_FADE_MS}ms ease'), 'narrative and delayed spans use opacity fades');
assert(loader.includes('Promise.all([fadeTo(continueButton, 0), fadeTo(stageText, 0)])'), 'Continue and page copy fade out before replacement');
assert(loader.includes("node.style.opacity = '1'"), 'delayed copy fades in from pre-laid-out hidden spans');""")
old_create = "const createElement=()=>{ const events=new Map(); const el={style:{},children:[],events,setAttribute(){},addEventListener:(name,fn)=>events.set(name,fn),append(...children){this.children.push(...children);},remove:()=>{removed=true;},focus(){}}; elements.push(el); return el; };"
new_create = "const createElement=()=>{ const events=new Map(); let html=''; const el={style:{},children:[],events,textContent:'',offsetWidth:1,setAttribute(){},addEventListener:(name,fn)=>events.set(name,fn),append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);return child;},remove:()=>{removed=true;},focus(){}}; Object.defineProperty(el,'innerHTML',{get(){return html;},set(value){html=String(value);if(value==='')this.children=[];}}); elements.push(el); return el; };"
if old_create not in test:
    raise SystemExit('dynamic createElement fixture target not found')
test = test.replace(old_create, new_create, 1)
test = test.replace("const runtimePreset={...preset,stages:preset.stages.map(stage=>({text:stage.text,minimumSeconds:3}))};", "const runtimePreset={...preset,stages:preset.stages.map(stage=>({text:stage.text,minimumSeconds:8}))};")
test = test.replace("assert.equal(stageText.textContent,runtimePreset.stages[i].text);", "assert.equal(stageText.children.at(-1)?.textContent,runtimePreset.stages[i].text);")
test = test.replace("assert.equal(continueButton.style.visibility,'hidden');", "assert.equal(continueButton.style.opacity,'0');")
test = test.replace("clock+=2999;assert.equal(timers[0].at,clock+1);\n    clock++;timers.shift().fn();", "clock+=7999;assert.equal(timers[0].at,clock+1);\n    clock++;timers.shift().fn();")
test = test.replace("assert.equal(continueButton.style.visibility,'visible');", "assert.equal(continueButton.style.opacity,'1');")
old_accept = """    if(i===1) subscriber({pressed:new Set(['Button0'])});
    else continueButton.events.get('click')();
    await done;assert.equal(continued,true);assert.equal(continueButton.disabled,true);
"""
new_accept = """    if(i===1) subscriber({pressed:new Set(['Button0'])});
    else continueButton.events.get('click')();
    await Promise.resolve();assert.equal(continued,false,'page replacement waits for the fade-out');
    clock+=900;for(const timer of timers.splice(0).filter(timer=>timer.at<=clock))timer.fn();for(let tick=0;tick<5;tick++)await Promise.resolve();
    await done;assert.equal(continued,true);assert.equal(continueButton.disabled,true);assert.equal(stageText.style.opacity,'0');
"""
if old_accept not in test:
    raise SystemExit('dynamic accept fixture target not found')
test = test.replace(old_accept, new_accept, 1)
test_path.write_text(test)
