# Certificate and theme release — 2026-10-14

Owner authorized production deployment in the current session after approving the brighter graphite and softened light lesson surfaces. This authorization supersedes PRODUCT.md's older push/deploy hold for this release only.

## Delivered
- Red/white/gray light dashboard, medium graphite dark mode, shared softer reading surfaces throughout the modules.
- Approved black/red theroofdocs.com certificate with Reese in the center, PNG and real single-page PDF.
- Rep downloads from My Page and certified/results screens use their authenticated saved certification record.
- Manager: Admin Dashboard → representative → View Details → certificate downloads.
- CMS Admin: Certificates → search name or certificate ID → PDF or PNG.
- Server-derived certificate identity/name/score/date, read-only record APIs, missing-record refusal, visible retryable errors.
- No database schema changes, no new certification awards, no grading or prerequisite changes.

## Local verification
- 38 unit tests passed.
- Client and server builds and UI lint passed.
- 22 browser scenarios covered; 21 passed in the complete run, with the rep fixture corrected to wait for application initialization; all four certificate scenarios then passed. CI runs the complete final suite.
- Two real HTTP/Postgres integration tests passed on a dedicated local database: anonymous refusal, rep/manager/CMS boundaries, own-record isolation, missing records, and matching identities across rep/admin retrieval.
- 60 full-page captures: 14 modules plus My Page, light/dark and desktop/mobile, in output/playwright/module-review (local ignored artifacts). Desktop contact sheets reviewed; mobile accessibility and horizontal overflow checked across all modules.
- Inspection flow tests use synthetic provider/media fixtures; this release does not claim new physical microphone proof.

## Release proof
Pending push, CI, deployed revision and health verification; record the final result after deployment.
