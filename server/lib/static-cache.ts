import type { Response } from 'express';
import path from 'node:path';

// Only Vite's fingerprinted JS/CSS can be cached forever. Public media keeps
// stable filenames, so it must revalidate when the content changes.
export function setStaticCacheHeaders(res: Response, filePath: string): void {
  const hashedBundle = /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(path.basename(filePath));
  res.setHeader('Cache-Control', hashedBundle
    ? 'public, max-age=31536000, immutable'
    : 'no-cache');
}
