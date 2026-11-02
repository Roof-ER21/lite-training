import { describe, expect, it } from 'vitest';
import {
  KONAMI, PUBLIC_SITE, createKonamiMatcher, createTapCounter, destroyUrl, siteToDestroy,
} from '../../easter-egg';

describe('hidden level: Konami code', () => {
  it('fires only on the final key', () => {
    const feed = createKonamiMatcher();
    const results = KONAMI.map(k => feed(k));
    expect(results.slice(0, -1).every(r => r === false)).toBe(true);
    expect(results.at(-1)).toBe(true);
  });

  it('is case-insensitive and resets after firing', () => {
    const feed = createKonamiMatcher();
    const keys = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'B', 'A'];
    expect(keys.map(feed).at(-1)).toBe(true);
    expect(feed('a')).toBe(false);
  });

  it('restarts on a wrong key, and a clean run after a mistake still works', () => {
    const feed = createKonamiMatcher();
    ['arrowup', 'arrowup', 'x'].forEach(feed);
    expect(KONAMI.map(feed).at(-1)).toBe(true);
    const feed2 = createKonamiMatcher();
    const threeUps = ['arrowup', 'arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
    expect(threeUps.map(feed2).at(-1)).toBe(false);
  });
});

describe('hidden level: logo taps', () => {
  it('needs 7 taps inside 4 s', () => {
    const tap = createTapCounter();
    for (let i = 0; i < 6; i++) expect(tap(1000 + i * 300)).toBe(false);
    expect(tap(1000 + 6 * 300)).toBe(true);
  });

  it('never fires on slow taps', () => {
    const tap = createTapCounter();
    for (let i = 0; i < 20; i++) expect(tap(i * 1000)).toBe(false);
  });

  it('starts over after firing', () => {
    const tap = createTapCounter();
    for (let i = 0; i < 7; i++) tap(i * 100);
    expect(tap(800)).toBe(false);
  });
});

describe('hidden level: the destroy link', () => {
  it('keeps a public https host, root only', () => {
    expect(siteToDestroy({ protocol: 'https:', hostname: 'a21.up.railway.app', origin: 'https://a21.up.railway.app' })).toBe('https://a21.up.railway.app/');
  });

  it('uses production for localhost, http and native shells', () => {
    expect(siteToDestroy({ protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:3101' })).toBe(PUBLIC_SITE);
    expect(siteToDestroy({ protocol: 'http:', hostname: 'example.test', origin: 'http://example.test' })).toBe(PUBLIC_SITE);
    expect(siteToDestroy({ protocol: 'capacitor:', hostname: 'localhost', origin: 'capacitor://localhost' })).toBe(PUBLIC_SITE);
    expect(siteToDestroy({ protocol: 'https:', hostname: '127.0.0.1', origin: 'https://127.0.0.1' })).toBe(PUBLIC_SITE);
    expect(siteToDestroy({ protocol: 'file:', hostname: '', origin: 'null' })).toBe(PUBLIC_SITE);
  });

  it('points only at the official game host and encodes the site', () => {
    const u = new URL(destroyUrl('https://a21.up.railway.app/'));
    expect(u.origin).toBe('https://destroy.spritefusion.com');
    expect(u.searchParams.get('url')).toBe('https://a21.up.railway.app/');
    expect(u.searchParams.get('from')).toBe('badge');
  });

  it('production address is this app', () => {
    expect(PUBLIC_SITE).toBe('https://a21.up.railway.app/');
  });
});
