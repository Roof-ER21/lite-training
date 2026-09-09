import { Request, Response, NextFunction } from 'express';

/**
 * Small in-memory rate limiter, per IP by default. Good enough for a
 * single-instance deployment — same trade-off as the limiter in
 * routes/gemini-proxy.ts.
 *
 * `keyFor` swaps the bucket key (the /mcp mount keys on the bearer's hash so
 * one office NAT does not starve every agent at once); an empty key falls
 * back to the IP. `message` overrides the 429 body.
 */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  name: string;
  keyFor?: (req: Request) => string;
  message?: string;
}) {
  const { windowMs, max, name, keyFor, message } = options;
  const hits = new Map<string, { count: number; reset: number }>();

  // Periodically drop expired windows so the map can't grow unbounded.
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now > entry.reset) hits.delete(key);
    }
  }, windowMs).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = (keyFor ? keyFor(req) : '') || req.ip || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.reset) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      console.warn(`Rate limit exceeded (${name}) for ${keyFor ? key.slice(0, 16) : key}`);
      return res.status(429).json({ error: message || 'Too many requests, please slow down' });
    }

    next();
  };
}
