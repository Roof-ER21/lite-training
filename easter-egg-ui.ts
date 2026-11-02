/**
 * Hidden-level easter egg (2026-11-02). Hidden on purpose: no button, no menu entry.
 *   - Keyboard: the Konami code (up up down down left right left right B A)
 *     anywhere outside a text field.
 *   - Phone: tap a Roof-ER logo or the ROOF-ER wordmark 7 times within 4 seconds.
 * Reward: a short tear-off (shingles fall), then a card linking to Sprite
 * Fusion's "Destroy Any Website" game aimed at our public site root. Link only
 * (new tab, noopener noreferrer); nothing third-party loads until it is clicked.
 * Pure logic and tests: easter-egg.ts, test/unit/easter-egg.test.ts.
 */
import { createKonamiMatcher, createTapCounter, destroyUrl, siteToDestroy } from './easter-egg';
import './easter-egg.css';

const BRAND_SELECTOR = '.training-wordmark, .login-logo, .sidebar-logo';
const SHINGLES = 32;
const BURST_MS = 1900;
const CARD_DELAY_MS = 700;

let mounted = false;
let card: HTMLElement | null = null;
let returnFocus: HTMLElement | null = null;

function typingInField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName);
}

/** True when following this link would only reload the page the visitor is on. */
function linkJustReloads(link: HTMLAnchorElement): boolean {
  if (!link.getAttribute('href') || link.target === '_blank') return false;
  const to = new URL(link.href, location.href);
  const here = new URL(location.href);
  if (to.hash) return false; // an in-page jump (e.g. the wordmark's skip to the lesson) is not a reload
  here.hash = '';
  return to.href === here.href;
}

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function tearOff(): void {
  document.querySelector('.egg-tearoff')?.remove();
  const layer = document.createElement('div');
  layer.className = 'egg-tearoff';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < SHINGLES; i++) {
    const s = document.createElement('span');
    s.className = `egg-shingle egg-shingle-${i % 4}`;
    s.style.setProperty('--x', `${(i * 37 + 11) % 100}%`);
    s.style.setProperty('--delay', `${(i * 53) % 700}ms`);
    s.style.setProperty('--w', `${22 + ((i * 7) % 18)}px`);
    s.style.setProperty('--spin', `${(i % 2 ? 1 : -1) * (120 + ((i * 29) % 160))}deg`);
    layer.append(s);
  }
  document.body.append(layer);
  window.setTimeout(() => layer.remove(), BURST_MS);
}

function closeCard(): void {
  if (!card) return;
  card.remove();
  card = null;
  document.removeEventListener('keydown', onEscape, true);
  if (returnFocus?.isConnected) returnFocus.focus();
  returnFocus = null;
}

function onEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !card) return;
  e.stopPropagation(); // the lesson drawer also listens for Escape; this press is ours
  closeCard();
}

function showCard(): void {
  if (card) { card.querySelector<HTMLElement>('.egg-close')?.focus(); return; }
  returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement : null;
  const el = document.createElement('div');
  el.className = 'egg-card';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  el.setAttribute('aria-labelledby', 'egg-title');
  el.innerHTML = `
    <button type="button" class="egg-close" aria-label="Close">&times;</button>
    <p class="egg-kicker">Easter egg found</p>
    <h2 id="egg-title" class="egg-title">You found the hidden level.</h2>
    <p class="egg-body">Seven knocks and the door opened. Want to tear the roof off this site?</p>
    <a class="egg-go" target="_blank" rel="noopener noreferrer">Tear off this website &rarr;</a>
    <p class="egg-credit">A game by Sprite Fusion. Opens in a new tab. Nothing real gets broken, and your training is saved.</p>`;
  const go = el.querySelector<HTMLAnchorElement>('.egg-go')!;
  go.href = destroyUrl(siteToDestroy(window.location));
  go.addEventListener('click', () => closeCard());
  el.querySelector<HTMLButtonElement>('.egg-close')!.addEventListener('click', () => closeCard());
  document.body.append(el);
  card = el;
  document.addEventListener('keydown', onEscape, true);
  el.querySelector<HTMLElement>('.egg-close')!.focus();
}

function reveal(): void {
  if (reducedMotion()) { showCard(); return; }
  tearOff();
  window.setTimeout(showCard, CARD_DELAY_MS);
}

export function mountEasterEgg(): void {
  if (mounted) return;
  mounted = true;
  const konami = createKonamiMatcher();
  const taps = createTapCounter();

  window.addEventListener('keydown', e => {
    if (typingInField(e.target)) return;
    if (konami(e.key)) reveal();
  });

  document.addEventListener('click', e => {
    const hit = (e.target as Element | null)?.closest?.(BRAND_SELECTOR);
    if (!hit) return;
    const link = hit.closest('a');
    if (link && linkJustReloads(link)) e.preventDefault();
    if (taps(performance.now())) reveal();
  }, true);
}
