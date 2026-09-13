# Inspection role-play upgrade — September 12, 2026

## Scope confirmed by Ahmed

This module teaches the **inspection process at rookie/easy difficulty**. It is not a
multi-topic or escalating-difficulty simulator. Both light and dark modes remain.
Security work is deferred. Existing inspection preparation points and exam content
were retained; this is not a rewrite of insurance or legal guidance.

## Implemented locally

- Replaced the active module entry with a dedicated inspection briefing, voice
  conversation, transcript, debrief, retry, and saved-practice flow. The same selected
  scenario supplies the briefing, model instruction, rubric, and stored record.
- Fixed rookie/easy throughout: patient homeowner, one simple question at a time,
  gentle hints, no difficulty escalation, door-slam scoring, or camera controls.
- Captures actual input/output speech transcription and joins streamed fragments into
  readable speaker turns. AudioWorklet microphone capture, mute, buffered-audio flush,
  interrupted playback cleanup, explicit session close, cancellation, and bounded
  connection setup replace the old active-session lifecycle.
- Separate AI debrief identifies covered/partial/missed preparation points, an exact
  rep quote for supported credit, and a next practice step. Totals are derived from
  those assessments. Unsupported evidence is rejected. AI feedback failure is explicit,
  retains the conversation, and offers retry; there is no keyword-score fallback.
- Finished practice preserves the existing module-completion policy even if feedback
  is unavailable. Denied microphone, empty speech, and disconnect alone do not complete
  the module. An interrupted conversation with rep speech can be explicitly ended and
  reviewed. Completion is not evidence of field competency or exam certification.
- Saves the scenario, transcript, and feedback locally, with separate confirmed server
  status, retry, device history, same-scenario practice, and JSON download. Server save
  uses one client session UUID, transactionally replaces criteria on retry, and returns
  the saved ID. No XP is awarded by this flow.
- Added compatible database columns for conversation logs and score details through the
  existing startup migration path. Existing columns and historical records remain.
- The earlier emoji-removal regression in legacy door-slam parsing was also fixed with
  dedicated tests. Legacy role-play helpers remain in the large source file but are
  bypassed by this module's new mount; do not mistake them for the active flow.

## Verification

- Full browser suite: 12 passed. All four inspection tests passed again after final transcript changes.
- Unit suite: 26 passed, including lifecycle races, duplicate End, failed feedback/save,
  late connection/feedback, supported evidence, and streaming fragments.
- Client/server builds and explicit frontend TypeScript check passed. UI token gate and
  git diff whitespace checks passed.
- Disposable local PostgreSQL: transcript read-back, unscored null, repeated saves and
  feedback updates without duplicates, record ownership, preserved legacy row, repeated
  additive migration, and no XP/exam writes passed.
- Inspection desktop 1280px and mobile 390px: no automated WCAG A/AA violations or page
  overflow in either theme. Screenshots inspected under output/playwright/inspection-*.
- Source comparison confirms exam arrays, module order, requirements, and existing
  storage keys are unchanged.
- Live Gemini check passed with synthetic speech through the real token and feedback
  endpoints: spoken homeowner output (178 audio parts), captured rep turn, two homeowner
  turns, and four validated feedback criteria. Streaming fragments initially caused
  unsupported quote matching; joining them fixed the real debrief check. The synthetic
  fixture covered all four points and received 100/100. This is integration evidence,
  not an assessment of overall coaching quality.
  No physical microphone or phone test has been performed.

## Delivery and remaining checks

Changes are local, uncommitted, on main at 763a216 in /Users/a21/lite-training-24.
Nothing has been pushed or deployed. Production migrations and live deployed behavior
are unverified. Local tests use Node 26; production Node 20 parity remains unverified.
The local preview is http://127.0.0.1:4317/ and has no API server. Full voice practice
requires the backend, database, and provider configuration.

Before calling this production-ready, run an actual microphone conversation on desktop
and phone, review beginner coaching quality, and verify the deployed server save/read-back.
This is a verification gap, not a request to expand topic or difficulty scope.

## Reproducing targeted checks

Build with npm run build; run npm run test:unit and npx playwright test.
The persistence script scripts/test-inspection-persistence.mjs pins its database to the
disposable local PostgreSQL instance on port 55439, never an inherited DATABASE_URL.
The opt-in scripts/test-inspection-provider.mjs spends Gemini quota on one synthetic
conversation and one debrief. It requires GEMINI_API_KEY, that disposable database,
and a nonempty 16 kHz mono signed-16-bit PCM fixture at
/private/tmp/lite-inspection-speech.pcm. It creates and deletes its own local test user.
Do not put this provider check into automatic tests or run it against production.
