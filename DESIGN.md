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

### Field workspace (local review)

The dashboard uses neutral gray surfaces with a bold red feature panel in light mode.
One illustrated next-lesson panel leads into a compact certification row and a
two-column course map (one column on phones). The sidebar is narrower, with a
single active indicator and quieter locked lessons. Reading pages use restrained
white or slate surfaces, a shorter line length, and compact navigation controls.
Light, Dark, and Use device setting remain available; dark mode uses medium
graphite with a red action, subtle borders, and white typography. Field photography
is monochrome so red, white, black, and gray remain the dominant palette. Theme values live in `theme.css`.

## Certificate of Completion

`certificate.ts` renders one polished certificate at 3300 x 2550 (US Letter
landscape, 300 dpi): charcoal double frame with a red keyline and corner
ornaments, the approved black-and-red theroofdocs.com logo, recipient
name, program, score, certification date, a stable certificate ID
(`RER-<year>-<hash>`), a red certified seal, and the three leadership
signatures. Downloads are a high-resolution PNG or a real single-page PDF
(the canvas is embedded into a hand-built PDF — no new dependencies).

Anyone recorded as certified can download it at any time: eligibility is
simply `isCertified`, whether it was earned on this device or synced from the
server (`certificationScore` is now synced and stored too). Download buttons
appear on the certified screen, on the passing results screen, and in a
dedicated My Page panel where the name on the certificate can be corrected
before downloading. See `RoofER-Certificate-Preview-v4.png` for a sample.

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

Lesson pages use gray canvases, soft reading panels, inset title bands with red edges, and distinct activity surfaces. Dark mode uses medium graphite throughout the shell and reading area; near-black is reserved for media.
