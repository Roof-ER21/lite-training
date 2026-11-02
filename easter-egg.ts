/**
 * Hidden-level easter egg: the pure parts (no DOM), so they can be unit-tested.
 *
 * Found by typing the Konami code on a keyboard, or by tapping a Roof-ER logo
 * or wordmark 7 times quickly (seven knocks, and the door opens). The reward
 * is a link to Sprite Fusion's "Destroy Any Website" game pointed at our
 * public site. It is only a link (new tab, no referrer); nothing from the
 * game loads into the app. The DOM half lives in easter-egg-ui.ts.
 */

export const KONAMI = [
  'arrowup', 'arrowup', 'arrowdown', 'arrowdown',
  'arrowleft', 'arrowright', 'arrowleft', 'arrowright',
  'b', 'a',
] as const;

/** Feed keys one at a time; returns true on the key that completes the code. */
export function createKonamiMatcher(): (key: string) => boolean {
  let pos = 0;
  return (key: string) => {
    const k = key.toLowerCase();
    if (k === KONAMI[pos]) {
      pos += 1;
      if (pos === KONAMI.length) { pos = 0; return true; }
      return false;
    }
    // A wrong key restarts, but it may itself be the start of a new attempt.
    pos = k === KONAMI[0] ? 1 : 0;
    return false;
  };
}

export const TAPS_NEEDED = 7;
export const TAP_WINDOW_MS = 4000;

/** Feed tap timestamps (ms); returns true when TAPS_NEEDED land inside the window. */
export function createTapCounter(needed = TAPS_NEEDED, windowMs = TAP_WINDOW_MS): (now: number) => boolean {
  let taps: number[] = [];
  return (now: number) => {
    taps = taps.filter(t => now - t < windowMs);
    taps.push(now);
    if (taps.length >= needed) { taps = []; return true; }
    return false;
  };
}

/** Public production address (Railway). */
export const PUBLIC_SITE = 'https://a21.up.railway.app/';

/**
 * Which page the game should "destroy": the site the visitor is on when it is a
 * real public https host, otherwise the production address (localhost, previews
 * over http, native shells). Always the site root, never a deep link: a path or
 * query could carry a session or token.
 */
export function siteToDestroy(loc: { protocol: string; hostname: string; origin: string }): string {
  const local = loc.hostname === '' || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(loc.hostname);
  if (loc.protocol === 'https:' && !local) return `${loc.origin}/`;
  return PUBLIC_SITE;
}

export function destroyUrl(site: string): string {
  return `https://destroy.spritefusion.com/?from=badge&url=${encodeURIComponent(site)}`;
}
