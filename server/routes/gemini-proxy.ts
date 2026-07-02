import { Router, Request, Response } from 'express';

/**
 * Server-side proxy for the browser's Gemini REST calls.
 *
 * The client SDK is pointed at /api/gemini (see index.tsx) so the real
 * GEMINI_API_KEY never ships in the bundle. The key is attached here,
 * server-side, per request.
 */
const router = Router();

const UPSTREAM = 'https://generativelanguage.googleapis.com';

// Only the inference surface the app actually uses — this must never become
// a general-purpose Google API relay (no token minting, tuning, file APIs).
const ALLOWED_PATH = /^\/v1(alpha|beta)?\/models\/[\w.-]+:(generateContent|streamGenerateContent|countTokens)(\?.*)?$/;

// Abuse of this endpoint burns real Gemini quota, so keep a small in-memory
// per-IP limit. Good enough for a single-instance deployment.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const hits = new Map<string, { count: number; reset: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.reset) {
    hits.set(ip, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

// Periodically drop expired windows so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (now > entry.reset) hits.delete(ip);
  }
}, WINDOW_MS).unref();

router.all(/.*/, async (req: Request, res: Response) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(503).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  // Browsers send Origin on every POST — reject other sites' pages while
  // still allowing localhost dev (vite serves the client on its own port).
  const origin = req.headers.origin;
  const host = req.headers.host || '';
  if (origin && !origin.includes(host) && !/^https?:\/\/localhost(:\d+)?$/.test(origin)) {
    return res.status(403).json({ error: 'Cross-origin use not allowed' });
  }

  if (req.method !== 'POST' || !ALLOWED_PATH.test(req.url)) {
    return res.status(403).json({ error: 'Path not allowed' });
  }

  if (isRateLimited(req.ip || 'unknown')) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const url = new URL(req.url, UPSTREAM);
  url.searchParams.delete('key'); // never forward a client-supplied key

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': req.headers['content-type'] || 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(req.body),
    });

    const body = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('content-type', contentType);
    res.send(body);
  } catch (error: any) {
    console.error('Gemini proxy error:', error);
    res.status(502).json({ error: 'Upstream request failed', details: error?.message });
  }
});

export default router;
