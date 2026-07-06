import { Request, Response, NextFunction } from 'express';

/**
 * Small in-memory per-IP rate limiter. Good enough for a single-instance
 * deployment — same trade-off as the limiter in routes/gemini-proxy.ts.
 */
export function rateLimit(options: { windowMs: number; max: number; name: string }) {
  const { windowMs, max, name } = options;
  const hits = new Map<string, { count: number; reset: number }>();

  // Periodically drop expired windows so the map can't grow unbounded.
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) {
      if (now > entry.reset) hits.delete(ip);
    }
  }, windowMs).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const entry = hits.get(ip);

    if (!entry || now > entry.reset) {
      hits.set(ip, { count: 1, reset: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      console.warn(`Rate limit exceeded (${name}) for ${ip}`);
      return res.status(429).json({ error: 'Too many requests, please slow down' });
    }

    next();
  };
}
