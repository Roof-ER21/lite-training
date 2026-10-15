# Admin progress and exam autosave — October 15, 2026

Changes based on main `3a2b7d1`. On October 15 the owner explicitly instructed “deploy now” for the pending alignment, admin progress, and exam autosave fixes. This overrides PRODUCT.md’s earlier push/deploy hold for this release.

## Behavior

- User table cells retain table layout, aligning every divider across the name, role, progress, certification, login, and action columns.
- Progress Grid shows the last lesson visited, exam attempt/status, answered/total counts, section counts, last focused question, and server save timestamp. It refreshes every 15 seconds while visible; failed refreshes retain the previous snapshot with a warning. Mobile displays learner cards and all four admin tabs.
- Exam inputs save immediately in the browser and sync after 500 ms of inactivity. Initial question order and empty work sync when the exam starts. Reconnect, visibility changes, page exit, and a 15-second retry interval flush pending work. Status distinguishes confirmed account saves from browser-only work.
- Opening the exam discovers unfinished account work, restores question order and answers, and provides a return-to-last-question control. Existing browser drafts upload when reopened. Unsubmitted work does not consume an attempt.
- Version checks reject stale writes; request IDs make retries after lost responses idempotent. Pending outgoing snapshots survive refresh. Conflicting local edits are retained in a `.recovery` browser storage entry while the newer server copy resumes. A stale form in another browser tab cannot overwrite a newer shared local draft.
- Starting an unlocked module now sets `in_progress`, preserving completed status on revisits.
- AI role-play retry controls say “Retry again.”

## Storage and boundaries

The additive startup migration adds `draft` (JSONB), `draft_revision`, and `draft_saved_at` to `exam_attempts`. Draft writes require the authenticated attempt owner and an unfinished attempt. The manager grid exposes progress summaries, not draft answer text. Final grading, certification, attempt limits, and submission recovery are unchanged. Drafts for previously open old-version pages become visible only once those clients load this version and sync.

## Verification

- Node 20 client/server build and UI lint pass.
- Four HTTP/PostgreSQL integration scenarios pass using the existing isolated local test runner: autosave/resume/access boundaries/conflicts, module status, transactional exam recovery, and completed-attempt limits.
- Browser scenarios cover server recovery after removing the local draft, answer types/order/location, offline retries, lost responses, device/tab conflicts, refresh/submission recovery, aligned table row bounds, and light/dark desktop/mobile layouts.
- Seven existing AI role-play browser scenarios pass, including disconnect/retry with the revised label. These use synthetic media/provider fixtures.
- Visual screenshots reviewed for users and progress in both themes, including 390px mobile cards and long names.
- A separate repository-wide `tsc --noEmit` is blocked by pre-existing syntax errors in unchanged `agnes-scenarios.js`; the project's server typecheck and Vite client build pass.

Release authorized October 15. Fresh Node 20 build, UI lint, all 40 unit tests, and four HTTP/PostgreSQL integration tests passed before release. All 10 targeted browser scenarios also passed: admin alignment/progress in both themes and mobile, exam autosave/recovery, and inspection role-play regressions. CI, deployment/migration completion, and live UI/health proof remain release verification steps; local evidence alone is not production proof.

## Design hook triage

All eight reported declarations predate this change; the admin additions begin after line 430. No additional UI changes were needed for these findings.

| CSS line | Finding | Disposition |
| --- | --- | --- |
| 336 | Caption side accent | Preserve the existing brand caption accent. |
| 350 | Heading side accent | Overridden by the later heading `border:0` rule at 384. |
| 352 | Promise side accent | Superseded by the later promise rule at 388. |
| 367 | Script/reference side accents | Preserve red-edged lesson surfaces documented in DESIGN.md. |
| 388 | Promise side accent | Preserve the documented lesson feature-panel styling. |
| 209 | Certificate top accent | Preserve the existing certificate panel keyline. |
| 325 | Topbar rounded-card warning | False positive: the topbar is not a rounded card. |
| 328 | Next-lesson top accent | Preserve the existing dashboard feature-panel keyline. |

Persisted `ignore-value` exceptions for `side-tab` and `border-accent-on-rounded`, each limited to `training-ui.css`, through the Impeccable CLI. Other rules and other files remain covered. These are agent dispositions based on the existing design documentation and CSS cascade, not new user-confirmed design choices. No hook findings remain deferred from this set.
