# Training interface

The workspace puts the next lesson, practice preparation, and exam standing first.
The learning path uses explicit Not started, In progress, Done, and Locked states.
Continue preserves the existing lesson order and saved progress.

## Visual system

`theme.css` defines shared semantic roles for white/light and dark themes. Brand
red is #B60807; white text on that fill has approximately 6.94:1 contrast. Dark
surfaces use light text for links instead of small red text. Gray text and field
borders have separate accessible roles. Geist and Geist Mono, restrained 2px
corners, fine dividers, and consistent spacing support extended reading.

`training-ui.css` defines the shell and final component styles. `index.css` keeps
legacy lesson layouts using the shared roles; theme-specific override rules,
gradients, and decorative motion have been removed. New colors belong in the
theme roles, not inline styles or component stylesheets.

## Interaction

- Search filters lesson titles. The mobile lesson drawer supports Escape,
  keyboard focus containment, and focus return.
- Lessons have a section index and heading focus on navigation.
- Completion offers Continue or Stay here without a countdown.
- Flip cards and sequence exercises have native keyboard controls. Image hotspot
  exercises support an arrow-key cursor, but still require visual interpretation.
- Role-play shows the selected scenario and preparation points before recording.
- Theme selection supports Light, Dark, and Use device setting, with persistence
  and a pre-paint bootstrap. Form colors switch immediately to preserve contrast.

## Boundaries

Arcade displays and confetti are removed. Stored XP/streak compatibility data and
prerequisite logic remain to avoid changing existing records and unlock behavior.
Exam scores remain visible. Assessment questions, keys, grading rules, attempt
history, certifications, signatures, agent controls, and activity tracking remain.

Security changes and deployment are deferred by the owner. Automatic-caption editorial review,
manual assistive-technology review, and live microphone/provider verification are
still separate acceptance work; automated scans do not establish WCAG conformance.

## Checks

Run `npm run test:unit` and `npm run test:ui`. The latter builds the app, checks
design rules, and runs isolated Chromium accessibility and interaction tests.
Browser fixtures mock APIs and do not write to production. CI targets Node 20.


## Learning workspace

`learning-workspace.ts` adds section resume, source-based recall practice, field
checklists, bookmarked references, and full-text search over unlocked lessons and
video transcripts. `training-media.ts` adds posters, automatic captions, searchable
transcripts, and playback recovery. `coaching-ui.ts` connects self-review and manager
assignments; `lesson-editor.ts` provides prose/guidance editing and saved-draft previews.
See `ENHANCEMENTS-2026-09-12.md` for verification, persistence, and acceptance boundaries.
