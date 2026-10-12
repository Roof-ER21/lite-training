# Training progression and role-play repair

User reports: the next training step was unclear and AI role play barely worked.

## Changes

- Every ordinary lesson has a visible, named next step and an explanation of the
  required activity. A direct activity jump and the bottom completion action use
  the same progression state. Completed lessons remain navigable on return.
- Reading completion now observes document scrolling as well as a scrollable lesson
  panel. Tracking is cleaned up on navigation. The signature gate remains explicit.
- Role-play completion offers Next: Final Exam in the debrief and lesson navigation.
  The finished-training dashboard opens assessment records instead of Welcome.
- Voice setup includes a local microphone meter and speaker tone, startup-stage
  messages, a no-transcription hint, and bounded microphone permission requests.
  Cancellation/timeouts release late microphone grants. Input uses the device audio
  rate before resampling, avoiding forced 16 kHz microphone contexts.
- Typed practice uses the same scenario and feedback. Interrupted voice can continue
  as typed practice without losing captured words. Failed homeowner replies retry
  without duplicating the rep turn; late replies cannot overwrite a newer session.
- Saved records distinguish voice, text, and mixed input. Existing records default
  to voice. No database migration or new provider is required.
- Practice start and completion bring the relevant controls/debrief into view,
  including on mobile. Both existing themes remain supported.

## Verification

- Node 20.20.2 client/server builds and UI token gate passed; 33 unit tests and
  18 browser tests passed on the final implementation.
- Browser tests cover actual document scrolling, named lesson transitions, completed
  dashboard, typed reply failure/retry, pending microphone cancellation, stream
  release, debrief-to-exam navigation, and existing training flows.
- Mobile lesson accessibility and overflow checks cover both themes. Role-play
  screenshots also cover 390px and 1280px in both themes.
- Disposable PostgreSQL on localhost:55439: voice/text/mixed read-back, same-ID
  retries, ownership, existing records, null scores, and no exam writes passed.
- Real Gemini through locally hosted authenticated endpoints: synthetic speech
  returned 189 audio parts, one rep turn, two homeowner turns, four validated
  feedback criteria, and a typed homeowner reply. This is provider integration
  proof, not a physical microphone or coaching-quality assessment.
- The edited role-play TypeScript modules typecheck. The large legacy index.tsx has
  36 existing diagnostics; a HEAD/current comparison found the same diagnostics.

## Release boundary

No production trainee data was used. Live browser access was denied during this
session and was not bypassed. Real desktop/phone microphone behavior and the
deployed signed-in flow remain unverified.

PRODUCT.md still explicitly says "Do not deploy or push." These changes are prepared
locally; publishing needs the owner to lift that restriction. Once authorized,
push the reviewed commit, wait for Training UI CI and the Railway deployment, and
verify the deployed revision and signed-in flow when browser access is permitted.

No schema rollback is needed: reverting the code restores the previous UI while
retaining saved text/mixed conversation logs. The existing voice model remains
supported today, but Google's retirement schedule should be reviewed before its
announced November 17, 2026 shutdown:
https://ai.google.dev/gemini-api/docs/deprecations/
