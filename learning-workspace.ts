import { announceTrainingStatus } from './training-ui';

type Entry = { module: string; title: string; section: string; anchor: string; text: string };
type Host = {
  content: Record<string, string>; modules: string[]; title: (id: string) => string;
  unlocked: () => string[]; navigate: (id: string) => void;
};
let host: Host;
let index: Entry[] = [];
let reader: IntersectionObserver | undefined;
let pendingAnchor: string | null = null;
const excluded = 'script,style,button,input,select,textarea,.quiz-options,.quiz-feedback,[hidden],.module-completion-section';
export const escapeText = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function key(name: string) { return `roof-er.workspace.${localStorage.getItem('roof-er.userId') || 'local'}.${name}`; }
function read<T>(name: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key(name)) || 'null') ?? fallback; } catch { return fallback; } }
function save(name: string, value: unknown) {
  try { localStorage.setItem(key(name), JSON.stringify(value)); return true; }
  catch { announceTrainingStatus('This browser could not save your changes. Free storage and try again.', true); return false; }
}
function textOf(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll(excluded).forEach(el => el.remove());
  return (copy.textContent || '').replace(/\s+/g, ' ').trim();
}
function entriesFor(module: string, html: string): Entry[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const headings = [...doc.querySelectorAll('h2')];
  return headings.map((heading, i) => {
    const section = textOf(heading);
    const pieces: string[] = [];
    let next = heading.nextElementSibling;
    while (next && !next.matches('h1,h2')) { pieces.push(textOf(next)); next = next.nextElementSibling; }
    return {module, title: host.title(module), section, anchor: heading.id || `lesson-section-${i}`, text: pieces.join(' ').trim()};
  }).filter(e => e.text.length > 35 && !/quiz|test your|game|certification|commitment/i.test(e.section));
}
function bookmarks(): string[] { return read('bookmarks', []); }
function entryId(entry: Entry) { return `${entry.module}:${entry.anchor}`; }
function openEntry(entry: Entry) { pendingAnchor = entry.anchor; host.navigate(entry.module); }

export function initLearningWorkspace(options: Host) {
  host = options;
  index = host.modules.filter(id => !['final-exam','commitment','role-play'].includes(id)).flatMap(id => entriesFor(id, host.content[id] || ''));
  const button = document.createElement('button');
  button.id = 'field-library-button'; button.type = 'button'; button.textContent = 'Field library';
  button.addEventListener('click', () => host.navigate('field-library'));
  document.querySelector('.training-topbar')?.append(button);
}

export function renderFieldLibrary(root: HTMLElement) {
  reader?.disconnect();
  root.innerHTML = `<div class="content-card field-library"><p class="eyebrow">Reference desk</p><h1>Find it. Use it in the field.</h1><p>Search your available lessons, scripts, and video transcripts. Save useful sections for later.</p><div class="reference-controls"><label>Search the library<input id="reference-query" type="search" placeholder="Try flashing, photo documentation, or an objection"></label><label>Show<select id="reference-filter" aria-label="Show"><option value="all">All references</option><option value="saved">Saved references</option></select></label></div><p id="reference-status" role="status"></p><div id="reference-results"></div></div>`;
  const query = root.querySelector<HTMLInputElement>('#reference-query')!;
  const filter = root.querySelector<HTMLSelectElement>('#reference-filter')!;
  const results = root.querySelector<HTMLElement>('#reference-results')!;
  const render = () => {
    const words = query.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const unlocked = host.unlocked();
    const saved = bookmarks();
    const matches = index.filter(e => unlocked.includes(e.module) && (filter.value !== 'saved' || saved.includes(entryId(e))) && words.every(w => `${e.title} ${e.section} ${e.text}`.toLowerCase().includes(w))).sort((a,b) => Number(b.section.toLowerCase().includes(query.value.toLowerCase().trim())) - Number(a.section.toLowerCase().includes(query.value.toLowerCase().trim())));
    root.querySelector('#reference-status')!.textContent = matches.length ? `${matches.length} matching references` : 'No matching references. Try a shorter phrase or another topic.';
    results.replaceChildren();
    matches.slice(0,60).forEach(entry => {
      const card = document.createElement('article'); card.className = 'reference-result';
      const position = words.length ? Math.max(0, entry.text.toLowerCase().indexOf(words[0]) - 70) : 0;
      card.innerHTML = `<p class="eyebrow">${escapeText(entry.title)}</p><h2>${escapeText(entry.section)}</h2><p>${position ? '…' : ''}${escapeText(entry.text.slice(position, position + 260))}${entry.text.length > position + 260 ? '…' : ''}</p><div class="reference-actions"><button type="button">Open section</button><button type="button" aria-pressed="${saved.includes(entryId(entry))}">${saved.includes(entryId(entry)) ? 'Saved' : 'Save reference'}</button></div>`;
      const buttons = card.querySelectorAll('button');
      buttons[0].onclick = () => openEntry(entry);
      buttons[1].onclick = () => {
        const ids = bookmarks(); const id = entryId(entry); const wasSaved = ids.includes(id);
        if (save('bookmarks', wasSaved ? ids.filter(x => x !== id) : [...ids,id])) {
          buttons[1].textContent = wasSaved ? 'Save reference' : 'Saved';
          buttons[1].setAttribute('aria-pressed', String(!wasSaved));
          announceTrainingStatus(wasSaved ? 'Reference removed from saved items.' : 'Reference saved on this device.');
        }
      };
      results.append(card);
    });
  };
  query.oninput = render; filter.onchange = render; render();
  loadTranscriptIndex().then(() => { if (root.contains(query)) render(); });
}

let transcriptsLoaded = false;
async function loadTranscriptIndex() {
  if (transcriptsLoaded) return;
  try {
    const response = await fetch('/assets/media/manifest.json');
    if (!response.ok) return;
    const manifest = await response.json();
    const additions = await Promise.all(Object.entries(manifest).map(async ([name, media]: [string, any]) => {
      const module = host.modules.find(id => id !== 'final-exam' && host.content[id]?.includes(name));
      if (!module) return [];
      const response = await fetch(media.transcript); if (!response.ok) return [];
      const transcript = await response.json();
      return [{module, title: host.title(module), section: `Video transcript · ${name.replace(/\.mp4$/,'').replace(/-/g,' ')}`, anchor: `media-${name.replace(/\.mp4$/,'')}`, text: transcript.cues.map((c: any) => c.text).join(' ')}];
    }));
    index.push(...additions.flat()); transcriptsLoaded = true;
  } catch { /* Lesson references remain available when media cannot be loaded. */ }
}

export function enhanceLesson(root: HTMLElement, module: string) {
  reader?.disconnect();
  if (!host.modules.includes(module) || ['final-exam','commitment','role-play'].includes(module)) return;
  const headings = [...root.querySelectorAll<HTMLElement>('h2')];
  const entries = entriesFor(module, root.innerHTML);
  if (!entries.length) return;
  // Refresh the search corpus with the actual published lesson being read.
  const live = entriesFor(module, root.innerHTML);
  index = [...index.filter(e => e.module !== module || e.anchor.startsWith('media-')), ...live];
  const guide = document.createElement('section'); guide.className = 'lesson-guide';
  const objectives = live.slice(0,3);
  guide.innerHTML = `<p class="eyebrow">Lesson guide</p><h2>What you’ll learn</h2><ul>${objectives.map(e => `<li>${escapeText(e.section)}</li>`).join('')}</ul><nav aria-label="Lesson activities"><button type="button" data-guide="learn">Read the lesson</button><button type="button" data-guide="practice">Practice recall</button><button type="button" data-guide="checklist">Field checklist</button></nav><div id="lesson-resume"></div>`;
  root.querySelector('.lesson-tools')?.after(guide);
  if (!guide.isConnected) root.querySelector('h1')?.after(guide);
  const checkpoint = read<Record<string,string>>('reading', {})[module];
  const move = (id: string) => {
    const target = root.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
    if (target) {
      if (headings.some(h => h.id === id)) save('reading', {...read('reading', {}), [module]: id});
      target.tabIndex = -1; target.scrollIntoView({block:'start'}); target.focus({preventScroll:true});
    }
  };
  if (checkpoint && headings.some(h => h.id === checkpoint)) {
    const resume = document.createElement('button'); resume.type = 'button'; resume.textContent = 'Resume last section';
    resume.onclick = () => move(checkpoint); guide.querySelector('#lesson-resume')?.append(resume);
  }
  const practice = document.createElement('section'); practice.id = 'lesson-recall'; practice.className = 'lesson-recall';
  let question = 0;
  const renderPractice = () => {
    const entry = objectives[question % objectives.length];
    practice.innerHTML = `<p class="eyebrow">Practice · no exam attempt</p><h2>Explain it in your own words</h2><p>What would you explain about <strong>${escapeText(entry.section)}</strong>?</p><label for="recall-response">Your explanation</label><textarea id="recall-response" rows="4" placeholder="Write the key points you would want a new teammate to understand."></textarea><button type="button" id="recall-reveal">Compare with the lesson</button><div id="recall-feedback" hidden></div>`;
    const answer = practice.querySelector<HTMLTextAreaElement>('textarea')!;
    answer.value = read<Record<string,string>>('practice-drafts', {})[entryId(entry)] || '';
    answer.oninput = () => { answer.setCustomValidity(''); save('practice-drafts', {...read('practice-drafts', {}), [entryId(entry)]: answer.value}); };
    practice.querySelector<HTMLButtonElement>('#recall-reveal')!.onclick = () => {
      if (!answer.value.trim()) { answer.setCustomValidity('Write an explanation before comparing.'); answer.reportValidity(); return; }
      const feedback = practice.querySelector<HTMLElement>('#recall-feedback')!;
      feedback.hidden = false;
      feedback.innerHTML = `<h3>Compare your explanation</h3><p>${escapeText(entry.text.slice(0,850))}</p><p>This is a self-review, not an AI grade. Check which points you explained clearly and what you would add.</p><button type="button" data-review>Review this section</button><button type="button" data-again>Needs more practice</button><button type="button" data-ready>Ready to explain</button><p role="status" id="recall-saved"></p><button type="button" data-next>Next practice prompt</button>`;
      feedback.querySelector<HTMLButtonElement>('[data-review]')!.onclick = () => move(entry.anchor);
      for (const status of ['again','ready']) feedback.querySelector<HTMLButtonElement>(`[data-${status}]`)!.onclick = () => {
        const record = {module, section: entry.section, anchor: entry.anchor, status: status === 'again' ? 'needs_practice' : 'ready', updatedAt: new Date().toISOString()};
        if (save('practice', {...read('practice', {}), [entryId(entry)]: record})) {
          feedback.querySelector('#recall-saved')!.textContent = status === 'again' ? 'Added to your practice review. Revisit the section and explain it again.' : 'Self-review saved. Try the next prompt.';
          void sendWorkspacePractice(record).then(synced => {
            const message = feedback.querySelector('#recall-saved');
            if (message?.isConnected) message.textContent += synced ? ' Shared with your coach.' : ' Saved on this device; not shared with your coach while offline.';
          });
        }
      };
      feedback.querySelector<HTMLButtonElement>('[data-next]')!.onclick = () => { question++; renderPractice(); practice.querySelector('textarea')?.focus(); };
    };
  };
  renderPractice();
  const checklist = document.createElement('section'); checklist.id = 'lesson-field-checklist'; checklist.className = 'field-checklist';
  checklist.innerHTML = `<p class="eyebrow">Before you use this in the field</p><h2>Your field checklist</h2><p>Use these prompts to check your preparation. These checks do not complete the lesson or change your assessment.</p>`;
  const checked = read<Record<string,boolean>>('checklists', {});
  objectives.forEach(entry => {
    const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!checked[entryId(entry)];
    input.onchange = () => save('checklists', {...read('checklists', {}), [entryId(entry)]: input.checked});
    label.append(input, document.createTextNode(`I can explain: ${entry.section}`)); checklist.append(label);
  });
  const card = root.querySelector('.content-card') || root;
  card.append(practice, checklist);
  guide.querySelector<HTMLButtonElement>('[data-guide="learn"]')!.onclick = () => move(headings[0]?.id || '');
  guide.querySelector<HTMLButtonElement>('[data-guide="practice"]')!.onclick = () => move(practice.id);
  guide.querySelector<HTMLButtonElement>('[data-guide="checklist"]')!.onclick = () => move(checklist.id);
  reader = new IntersectionObserver(changes => {
    const visible = changes.filter(c => c.isIntersecting).sort((a,b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (visible) save('reading', {...read('reading', {}), [module]: visible.target.id});
  }, {rootMargin:'-100px 0px -55% 0px'});
  headings.forEach(h => reader!.observe(h));
  if (pendingAnchor) { const id = pendingAnchor; pendingAnchor = null; requestAnimationFrame(() => move(id)); }
  addVisualWorkbench(root,module);
}

function addVisualWorkbench(root: HTMLElement, module: string) {
  const sets: Record<string, {title: string; images: [string,string,string][]}> = {
    'general-knowledge': {title:'Roof components at a glance', images:[['/assets/roof-components/ridge.jpg','Ridge','Review the ridge photo alongside the component definitions below.'],['/assets/roof-components/valley.jpg','Valley','Compare where roof planes meet in the valley photo.'],['/assets/roof-components/flashing.jpg','Flashing','Use this close-up to recognize the flashing discussed in the lesson.']]},
    'damage-identification': {title:'Compare the lesson examples', images:[['/assets/damage/hail/hail-damage-1.jpg','Hail example','Compare the marks in this source photo with the hail indicators in the lesson.'],['/assets/damage/wind/wind2.jpg','Wind example','Locate the exposed dark areas where shingle coverage is missing in this source example.']]},
    'inspection-process': {title:'Worked example: close-up and context', images:[['/assets/photo-strategy/step7-mark-damage.jpg','1. Capture the detail','A close-up records the condition being documented.'],['/assets/photo-strategy/step8-damage-overview.jpg','2. Show its location','Pair the close-up with an overview, as the photo strategy below describes.']]},
  };
  const set = sets[module]; if (!set) return;
  const section = document.createElement('section'); section.className = 'visual-workbench';
  section.innerHTML = `<p class="eyebrow">Visual reference</p><h2>${set.title}</h2><div class="visual-comparison">${set.images.map(([src,title,caption]) => `<figure><img src="${src}" alt="${title} from the existing Roof-ER lesson" loading="lazy"><figcaption><strong>${title}</strong><p>${caption}</p><a href="${src}" target="_blank" rel="noopener">Open full-size photo</a></figcaption></figure>`).join('')}</div><p class="source-note">Existing training-library examples. Use the lesson guidance when interpreting a specific roof.</p>`;
  root.querySelector('.lesson-guide')?.after(section);
  if (module === 'inspection-process') {
    const steps = [...root.querySelectorAll<HTMLElement>('.inspection-step-card')];
    const sequence = document.createElement('ol'); sequence.className='inspection-reference-sequence';
    sequence.setAttribute('aria-label','Inspection sequence from this lesson');
    steps.forEach((step,i) => {
      const item=document.createElement('li'); const button=document.createElement('button');button.type='button';
      button.textContent=`${i+1}. ${step.querySelector('h3')?.textContent?.trim() || 'Inspection step'}`;
      button.onclick=()=>{step.classList.add('expanded');step.tabIndex=-1;step.scrollIntoView({block:'start'});step.focus({preventScroll:true});};
      item.append(button);sequence.append(item);
    });
    section.append(sequence);
  }
}

async function sendWorkspacePractice(record: unknown): Promise<boolean> {
  try { return (await fetch('/api/coaching/practice', {method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${localStorage.getItem('roof-er.sessionToken') || ''}`}, body:JSON.stringify(record)})).ok; } catch { return false; }
}

export function addPracticeReview(root: HTMLElement) {
  const records = Object.values(read<Record<string,any>>('practice', {})).filter(r => r.status === 'needs_practice');
  const panel = document.createElement('section'); panel.className = 'practice-review';
  panel.innerHTML = '<h2>Your practice review</h2><p>Sections you marked for another pass. Self-review is saved on this device.</p>';
  const sync = document.createElement('button'); sync.type='button'; sync.textContent='Sync practice with coach';
  const syncStatus = document.createElement('p'); syncStatus.setAttribute('role','status');
  sync.onclick=async()=>{
    sync.disabled=true; syncStatus.textContent='Syncing your self-reviews…';
    const all=Object.values(read<Record<string,unknown>>('practice',{}));
    const results=await Promise.all(all.map(sendWorkspacePractice));
    syncStatus.textContent=results.every(Boolean) ? 'Self-reviews shared with your coach.' : 'Some self-reviews could not sync. They remain saved here; reconnect and try again.';
    sync.disabled=false;
  };
  if(Object.keys(read('practice',{})).length)panel.append(sync,syncStatus);
  if (!records.length) panel.insertAdjacentHTML('beforeend','<p>After a lesson, try Practice recall to find what you want to revisit.</p>');
  records.filter(r => host.unlocked().includes(r.module)).forEach(r => {
    const button = document.createElement('button'); button.textContent = `${host.title(r.module)} · ${r.section}`;
    button.onclick = () => openEntry({...r,title:host.title(r.module),text:''}); panel.append(button);
  });
  root.querySelector('#learning-path')?.parentElement?.after(panel);
}
