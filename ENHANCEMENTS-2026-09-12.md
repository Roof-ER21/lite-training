# Learning experience upgrade

**Role-play update:** Ahmed clarified inspection process only, fixed rookie/easy.
The active flow now has a matching briefing/model scenario, captured speech transcript,
evidence-based debrief, cleanup, and confirmed save/retry states. See
`ROLEPLAY-REVIEW-2026-09-12.md` for implementation and exact verification limits.

Implemented locally in `/Users/a21/lite-training-24`, on the existing dirty `main`
checkout at `763a216`. Nothing committed, pushed, deployed, or written to production.

## What reps can do

1. **Follow a lesson guide.** Reading lessons have a topic overview, links to reading,
   recall practice, and a field-preparation checklist. Reopening a lesson offers the
   last viewed section. Existing exercises, completion requirements, commitment,
   certification, and exam behavior are retained.
2. **Use the field library.** Search available lesson text and scripts plus video
   transcripts. Section-title matches rank above incidental body matches. Open the
   relevant section, bookmark it, and filter saved references. Existing lesson locks
   still apply. Bookmarks and reading positions are scoped to the rep on this device.
3. **Compare visual references.** Roofing basics, damage identification, and inspection
   have side-by-side source photos with explanatory captions and full-size links.
   Inspection includes a close-up/context worked example and an interactive sequence
   linked to the existing steps. These use actual library photos, not generated roofs.
4. **Practice recall and act on feedback.** Write an explanation, compare it against
   the source lesson, mark it ready or needing practice, and try another prompt.
   The dashboard brings back sections needing review. This is explicitly self-review,
   not an AI grade or an exam attempt. Local save and coach-sync outcomes are distinct;
   a retry control shares local self-reviews when online.
5. **Use accessible media companions.** All 12 referenced training videos have poster
   images, automatic English WebVTT captions, searchable timestamped transcripts, and
   transcript section navigation. Playback has buffering and retry messages. Transcript
   navigation does not bypass existing video-watch requirements. Source hosting is
   unchanged. Generated media assets total approximately 766 KB.
6. **Receive coaching; author lessons.** Managers can see rep self-reviews in rep
   details, assign a lesson with a shared note, and see when the rep marks it reviewed.
   Reps see coaching on their dashboard. The content editor edits prose and structured
   learning guidance, previews in a sandboxed frame, saves drafts, selects historical
   versions, and explicitly publishes a saved draft through the existing CMS.

## Problems fixed during implementation

- Draft creation omitted a required content ID and could fail against the actual schema.
- Concurrent draft creation could choose the same version number.
- Publishing archived the live lesson before validating its replacement. Draft creation
  and publication now use transactions and a per-module row lock.
- The old version selector did not fetch the selected version.
- The old editor tried to update published content instead of creating a draft.
- Cached published content could hide an edit when a rep reopened a lesson.
- Late lesson fetches could overwrite a newer navigation; rendering now has a sequence guard.
- Mobile focus scrolling could move checkboxes during a click. Only text fields now
  receive the keyboard-oriented focus scroll treatment.
- Content-editor sign-in had only a hidden trigger; it now has a visible entry control
  using the existing authentication and permissions.

## Storage and delivery

`server/db/workspace-schema.ts` adds `learning_practice` and `coaching_assignments`.
The existing startup migration path applies these additive tables. Existing progress,
assessment, signature, certification, and identity tables are not migrated or reset.
Coaching routes use the existing authentication and manager middleware.

The editor uses existing CMS content/version storage. Existing installations still
need to import their lessons through the CMS's Import Existing Training Content action
if the CMS is empty. No production import was performed. Reese needs an existing
content-editor account; no new account or permission was provisioned.

## Verification

- Production build and design lint pass.
- TypeScript check of the new frontend modules passes.
- 14 unit tests pass, including media manifest, caption, transcript timing, and asset checks.
- Browser verification covers both themes across all lessons, the active exam, mobile
  overflow/axe scans, records, drawer/keyboard exercises, section resume, saved references,
  recall/checklists, transcripts, editor draft/publish, and decoded video with native captions.
- `scripts/test-learning-persistence.mjs` passes against an isolated temporary local
  PostgreSQL cluster: practice upsert, assignment/read/review, record isolation, concurrent
  drafts, invalid-publish rollback, atomic publish, and idempotent additive schema.
- Source comparison confirms all three exam arrays, module order, requirements, and
  existing storage keys match the pre-enhancement baseline exactly.
- Screenshots in `output/playwright/`: `lesson-upgrade-*` and `library-upgrade-*`.

## Acceptance still needed

- Captions are automatic and visibly labeled. A human should review the wording,
  particularly names, roofing terminology, and the existing insurance statements.
- The new lesson guides reuse existing material; this is not a wholesale curriculum
  rewrite or legal/content sign-off. Reese/legal still own the flagged content.
- Photo interpretation still needs equivalent nonvisual teaching and manual
  assistive-technology/device review. Automated scans are not WCAG certification.
- Live microphone/provider behavior and production media transport were not tested.
- Local tests used Node 26.8.1. CI targets the required Node 20; remote CI has not run.
- Security, hosting procurement, account provisioning, and production deployment remain
  outside this local implementation. Ahmed owns deployment.

Local preview: http://127.0.0.1:4317/ . Its API is offline; shared coaching requires
the backend and database. `npm run test:ui` runs repeatable isolated browser fixtures.
