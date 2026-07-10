/**
 * GlitchTip Error Reporter
 * ------------------------
 * Minimal Sentry-store-API client (GlitchTip is Sentry-protocol-compatible).
 * Deliberately NOT @sentry/node: an env-gated fetch adds zero dependencies;
 * GlitchTip ingest only needs the /api/{project}/store/ endpoint.
 *
 * Enabled by setting GLITCHTIP_DSN (or SENTRY_DSN) — e.g.
 *   GLITCHTIP_DSN=https://<key>@glitchtip.4anile.com/4
 * Unset → every call is a silent no-op. Never throws, never blocks a request
 * (fire-and-forget with a 5s timeout).
 */

const SENTRY_CLIENT = 'lite-training-node/1.0';

export interface DsnParts {
  publicKey: string;
  storeUrl: string;
}

/**
 * Parse a Sentry-format DSN: {proto}://{publicKey}@{host}[/path]/{projectId}
 * Returns null on anything malformed — a bad DSN must disable reporting,
 * not break the app.
 */
export function parseDsn(dsn: string | undefined | null): DsnParts | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const segments = url.pathname.split('/').filter(Boolean);
    const projectId = segments.pop();
    if (!publicKey || !projectId || !/^\d+$/.test(projectId)) return null;
    const basePath = segments.length ? `/${segments.join('/')}` : '';
    return {
      publicKey,
      storeUrl: `${url.protocol}//${url.host}${basePath}/api/${projectId}/store/`,
    };
  } catch {
    return null;
  }
}

function getDsn(): DsnParts | null {
  return parseDsn(process.env.GLITCHTIP_DSN || process.env.SENTRY_DSN);
}

export function isGlitchTipEnabled(): boolean {
  return getDsn() !== null;
}

export interface CaptureInput {
  endpoint: string;
  message: string;
  stack?: string;
  level?: 'error' | 'warning' | 'fatal';
}

/** Build the Sentry event payload. Exported for tests. */
export function buildEvent(input: CaptureInput): Record<string, unknown> {
  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: input.level || 'error',
    logger: input.endpoint,
    message: input.message.slice(0, 500),
    environment:
      process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development',
    server_name: process.env.RAILWAY_SERVICE_NAME || 'lite-training',
    release: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) || undefined,
    tags: { endpoint: input.endpoint },
    exception: {
      values: [
        {
          type: 'Error',
          value: input.message.slice(0, 500),
        },
      ],
    },
    extra: input.stack ? { stack: input.stack.slice(0, 4000) } : undefined,
  };
}

/**
 * Fire-and-forget error report. Safe to call unconditionally from hot paths:
 * no-op without a DSN, swallows every failure, 5s cap.
 */
export function captureToGlitchTip(input: CaptureInput): void {
  const dsn = getDsn();
  if (!dsn) return;

  void fetch(dsn.storeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=${SENTRY_CLIENT}, sentry_key=${dsn.publicKey}`,
    },
    body: JSON.stringify(buildEvent(input)),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    // Error reporting must never create errors.
  });
}
