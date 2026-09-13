# Lite Training V2
# Build timestamp: 1769034703

## Training experience release 1.1.0

See [CHANGELOG.md](CHANGELOG.md) for the learner-facing changes and
[ROLEPLAY-REVIEW-2026-09-12.md](ROLEPLAY-REVIEW-2026-09-12.md) for inspection practice
behavior and verification limits. Inspection role-play stays at rookie/easy.

Production deploys from `main` to https://a21.up.railway.app. The app applies additive
coaching and inspection-record migrations on startup. Keep the database and Gemini
provider configuration available; a static preview alone cannot run voice practice
or sync training records. `GEMINI_LIVE_MODEL` and `GEMINI_SCORING_MODEL` can override
the server model defaults.

Release checks: `npm run test:unit` and `npm run test:ui` (Node 20, Chromium installed).
The opt-in local persistence and synthetic-provider checks are documented in the
role-play report; they are not production test scripts.
