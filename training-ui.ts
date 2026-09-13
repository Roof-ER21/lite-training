/** Presentation and accessibility only. Training records and gating stay in index.tsx. */
let drawerOpen = false;
let activeDialog: HTMLElement | null = null;
let returnFocus: HTMLElement | null = null;
const inertBefore = new Map<HTMLElement, boolean>();
const focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
const visible = (el: HTMLElement) => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';

export function announceTrainingStatus(message: string, urgent = false): void {
  const region = document.getElementById(urgent ? 'training-alert' : 'training-status');
  if (region && region.textContent !== message) region.textContent = message;
}

export function closeTrainingDrawer(): void {
  if (!drawerOpen) return;
  drawerOpen = false;
  document.body.classList.remove('training-drawer-open');
  document.getElementById('training-menu')?.setAttribute('aria-expanded', 'false');
  const sidebar = document.getElementById('sidebar');
  if (sidebar && matchMedia('(max-width: 767px)').matches) sidebar.inert = true;
  const backdrop = document.getElementById('training-backdrop');
  if (backdrop) backdrop.hidden = true;
  const main = document.getElementById('main-content');
  if (main) main.inert = false;
  document.getElementById('training-menu')?.focus();
}

function wrapChoice(item: HTMLElement): void {
  if (item.querySelector(':scope > button')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = item.closest('#sidebar') ? 'training-nav-button' : 'training-choice-button';
  while (item.firstChild) button.append(item.firstChild);
  item.append(button);
}

function improveControls(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('#sidebar li[data-module], .quiz-options > li').forEach(wrapChoice);
  root.querySelectorAll<HTMLElement>('.quiz-options > li').forEach(item => item.querySelector('button')?.setAttribute('aria-pressed', String(item.classList.contains('selected'))));
  root.querySelectorAll<HTMLElement>('.objection-flip-card').forEach(card => {
    const flipped = card.classList.contains('flipped');
    card.setAttribute('aria-pressed', String(flipped));
    card.querySelector('.flip-card-front')?.setAttribute('aria-hidden', String(flipped));
    card.querySelector('.flip-card-back')?.setAttribute('aria-hidden', String(!flipped));
  });
  root.querySelectorAll<HTMLElement>('#sidebar li[data-module]').forEach(item => {
    const button = item.querySelector<HTMLButtonElement>(':scope > button');
    if (!button) return;
    const current = item.classList.contains('active');
    if (current) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    button.disabled = item.classList.contains('locked');
    button.title = button.disabled ? 'Complete the preceding lessons to open this lesson' : '';
  });
  root.querySelectorAll<HTMLElement>('[onclick]:not(button):not(a):not(input):not(select):not(textarea), .quiz-option, .option-card').forEach(el => {
    if (el.matches('label') || el.querySelector('input,button,a')) return;
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    if (el.classList.contains('objection-flip-card')) el.setAttribute('aria-pressed', String(el.classList.contains('flipped')));
  });
  root.querySelectorAll<HTMLElement>('.quiz-feedback, [id$="-feedback"], .login-error, #agnes-error').forEach(el => {
    if (!el.hasAttribute('role')) el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
  });
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input:not([type="hidden"]),textarea,select').forEach(input => {
    if (input.labels?.length || input.hasAttribute('aria-label') || input.hasAttribute('aria-labelledby')) return;
    const name = input.getAttribute('placeholder') || input.getAttribute('name');
    if (!name) return;
    if (!input.id) input.id = 'training-input-' + crypto.randomUUID();
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.className = 'training-input-label';
    label.textContent = name;
    input.before(label);
  });
  root.querySelectorAll<HTMLImageElement>('img').forEach(img => {
    if (!img.hasAttribute('decoding')) img.decoding = 'async';
    if (!img.hasAttribute('fetchpriority') && !img.closest('#sidebar')) img.loading = 'lazy';
  });
  root.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    if (button.textContent?.trim() || button.querySelector('svg')) return;
    const title = button.getAttribute('aria-label') || button.title || button.id.replace(/[-_]/g, ' ').replace(/\b(btn|button)\b/g, '').trim();
    if (title) { button.setAttribute('aria-label', title); button.textContent = title; }
  });
  root.querySelectorAll<HTMLElement>('[draggable="true"]').forEach(item => {
    if (item.dataset.keyboardReady) return;
    item.dataset.keyboardReady = 'true';
    const move = document.createElement('button');
    move.type = 'button';
    move.className = 'sequence-move';
    move.textContent = 'Move';
    move.setAttribute('aria-label', 'Move ' + item.textContent?.trim() + ' between options and sequence');
    move.addEventListener('click', event => {
      event.stopPropagation();
      const inspection = item.classList.contains('inspection-drag-item');
      const pool = document.getElementById(inspection ? 'inspection-items-pool' : 'items-pool');
      const sequence = document.getElementById(inspection ? 'inspection-sorted-list' : 'sorted-list');
      const destination = pool?.contains(item) ? sequence : pool;
      if (!destination) return;
      const transfer = new DataTransfer();
      item.dispatchEvent(new DragEvent('dragstart', {bubbles:true,dataTransfer:transfer}));
      destination.dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:transfer}));
      item.dispatchEvent(new DragEvent('dragend', {bubbles:true,dataTransfer:transfer}));
      move.focus();
      announceTrainingStatus('Item moved. Build the sequence in order; move an item back to change its position.');
    });
    item.append(move);
  });
  root.querySelectorAll<HTMLImageElement>('.clickable-quiz-image').forEach(img => {
    if (img.dataset.keyboardReady) return;
    img.dataset.keyboardReady = 'true';
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.setAttribute('aria-label', `${img.alt}. Arrow keys move the target. Enter marks a location.`);
    const cursor = document.createElement('span');
    cursor.className = 'keyboard-hotspot-cursor';
    cursor.setAttribute('aria-hidden','true');
    cursor.hidden = true;
    img.parentElement?.append(cursor);
    let x = 50, y = 50;
    const position = () => {
      cursor.style.left = img.offsetLeft + img.clientWidth * x / 100 + 'px';
      cursor.style.top = img.offsetTop + img.clientHeight * y / 100 + 'px';
    };
    img.addEventListener('focus', () => { cursor.hidden = false; position(); });
    img.addEventListener('blur', () => { cursor.hidden = true; });
    img.addEventListener('keydown', event => {
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'ArrowLeft') x = Math.max(0,x - 5);
        if (event.key === 'ArrowRight') x = Math.min(100,x + 5);
        if (event.key === 'ArrowUp') y = Math.max(0,y - 5);
        if (event.key === 'ArrowDown') y = Math.min(100,y + 5);
        position();
        if (event.key === 'Enter' || event.key === ' ') {
          const bounds = img.getBoundingClientRect();
          img.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:bounds.left + bounds.width*x/100,clientY:bounds.top + bounds.height*y/100}));
        }
      }
    });
  });
}

function syncDialogs(): void {
  const candidates = [...document.querySelectorAll<HTMLElement>('#login-screen, .module-complete-modal, .review-modal-overlay, .photo-modal-overlay, .modal-overlay, [id$="-modal"]')].filter(visible);
  const modal = candidates.reverse().find(el => !candidates.some(other => other !== el && other.contains(el))) || null;
  if (modal === activeDialog) return;
  inertBefore.forEach((value, el) => { el.inert = value; });
  inertBefore.clear();
  if (activeDialog) {
    activeDialog.removeAttribute('aria-modal');
    if (returnFocus?.isConnected && visible(returnFocus)) returnFocus.focus();
  }
  activeDialog = modal;
  if (!modal) return;
  returnFocus = document.activeElement as HTMLElement;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const heading = modal.querySelector<HTMLElement>('h1,h2,h3');
  if (heading) {
    if (!heading.id) heading.id = 'dialog-heading-' + crypto.randomUUID();
    modal.setAttribute('aria-labelledby', heading.id);
  } else modal.setAttribute('aria-label', 'Training dialog');
  let branch: HTMLElement = modal;
  while (branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling !== branch && sibling instanceof HTMLElement && !sibling.matches('[aria-live]')) {
        inertBefore.set(sibling, sibling.inert);
        sibling.inert = true;
      }
    }
    if (branch.parentElement === document.body) break;
    branch = branch.parentElement;
  }
  modal.tabIndex = -1;
  (Array.from(modal.querySelectorAll<HTMLElement>(focusable)).find(visible) || modal).focus();
}

export function enhanceTrainingContent(root: HTMLElement, moduleName: string, title: string): void {
  root.dataset.lesson = moduleName;
  improveControls(document);
  document.getElementById('training-current-title')!.textContent = moduleName === 'my-page' ? 'Your training' : title;
  if (!['my-page','field-library','admin-dashboard'].includes(moduleName) && !root.querySelector('.lesson-reading-tools')) {
    const tools = document.createElement('div');
    tools.className = 'lesson-reading-tools';
    const headings = Array.from(root.querySelectorAll<HTMLHeadingElement>('h2')).filter(h => !h.closest('[style*="display: none"], [style*="display:none"], .modal, [id$="-modal"]')).slice(0, 12);
    if (headings.length > 1) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'In this lesson';
      details.append(summary);
      const nav = document.createElement('nav');
      nav.setAttribute('aria-label', 'In this lesson');
      headings.forEach((heading, i) => {
        if (!heading.id) heading.id = 'lesson-section-' + i;
        const link = document.createElement('a');
        link.href = '#' + heading.id;
        link.textContent = heading.textContent;
        link.addEventListener('click', () => { heading.tabIndex = -1; heading.focus({preventScroll:true}); details.open = false; });
        nav.append(link);
      });
      details.append(nav);
      tools.append(details);
      const card = root.querySelector('.content-card') || root;
      card.querySelector('h1')?.after(tools);
    }
  }
  const heading = root.querySelector<HTMLElement>('h1');
  if (heading) { heading.tabIndex = -1; heading.focus({preventScroll:true}); }
  root.scrollTop = 0;
  window.scrollTo({top:0,behavior:'instant'});
  announceTrainingStatus(moduleName === 'my-page' ? 'Your training' : title + ' opened');
}

export function initTrainingInterface(): void {
  const menu = document.getElementById('training-menu');
  const sidebar = document.getElementById('sidebar');
  const main = document.getElementById('main-content');
  const backdrop = document.getElementById('training-backdrop');
  const phone = matchMedia('(max-width: 767px)');
  const syncSize = () => { closeTrainingDrawer(); if (sidebar) sidebar.inert = phone.matches; };
  syncSize();
  phone.addEventListener('change', syncSize);
  menu?.addEventListener('click', () => {
    if (drawerOpen) { closeTrainingDrawer(); return; }
    drawerOpen = true;
    document.body.classList.add('training-drawer-open');
    menu.setAttribute('aria-expanded','true');
    if (backdrop) backdrop.hidden = false;
    if (main) main.inert = true;
    if (sidebar) { sidebar.inert = false; sidebar.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }
  });
  backdrop?.addEventListener('click', closeTrainingDrawer);
  document.getElementById('training-close-menu')?.addEventListener('click', closeTrainingDrawer);
  document.getElementById('training-nav-search')?.addEventListener('input', event => {
    const query = (event.target as HTMLInputElement).value.toLowerCase().trim();
    document.querySelectorAll<HTMLElement>('#sidebar li[data-module]').forEach(li => { li.hidden = !!query && !li.textContent?.toLowerCase().includes(query); });
  });
  const updateConnection = () => {
    const banner = document.getElementById('training-offline');
    if (banner) banner.hidden = navigator.onLine;
    if (!navigator.onLine) announceTrainingStatus('You are offline. Saved lessons remain available. AI practice needs a connection.');
  };
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
  updateConnection();
  document.addEventListener('keydown', event => {
    const target = event.target as HTMLElement;
    if ((event.key === 'Enter' || event.key === ' ') && target.matches('[role="button"]:not(button)')) { event.preventDefault(); target.click(); }
    if (event.key === 'Escape' && drawerOpen) { event.preventDefault(); closeTrainingDrawer(); }
    if (event.key === 'Escape' && activeDialog) {
      const close = activeDialog.querySelector<HTMLElement>('[data-close-modal], .modal-close, .close-review, .photo-modal-close, #close-modal-btn, .close-btn');
      if (close) { event.preventDefault(); close.click(); }
    }
    const boundary = activeDialog || (drawerOpen ? sidebar : null);
    if (event.key === 'Tab' && boundary) {
      const items = Array.from(boundary.querySelectorAll<HTMLElement>(focusable)).filter(visible);
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); boundary.focus(); }
      else if (event.shiftKey && (target === first || !boundary.contains(target))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (target === last || !boundary.contains(target))) { event.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('focusin', event => {
    const target = event.target as HTMLElement;
    if (phone.matches && target.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),textarea')) target.scrollIntoView({block:'center',behavior:'instant'});
  });
  let pending = false;
  new MutationObserver(records => {
    for (const record of records) {
      const el = record.target instanceof HTMLElement ? record.target : record.target.parentElement;
      if (el?.closest('#training-status,#training-alert')) continue;
      const feedback = el?.closest('.quiz-feedback,[id$="-feedback"],#agnes-status-text');
      if (feedback?.textContent && visible(feedback as HTMLElement)) announceTrainingStatus(feedback.textContent.trim());
      if (el?.matches('button,#loader') && /Processing|Generating your quiz|Scoring/.test(el.textContent || '')) announceTrainingStatus(el.textContent!.trim());
    }
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; improveControls(document); syncDialogs(); });
  }).observe(document.body,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['class','style']});
  improveControls(document);
}
