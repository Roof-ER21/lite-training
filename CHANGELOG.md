# Changelog

## Unreleased — training usability

- Make the next lesson and its requirements visible; fix reading completion when
  the whole page scrolls and keep completed trainees at their assessment records.
- Add a direct final-exam action after inspection practice, microphone/speaker
  checks, clearer connection recovery, and a typed alternative with saved history.
- Preserve interrupted conversations when switching to typing and prevent duplicate
  replies or leaked microphones after cancellation.

## 1.1.0 — 2026-09-12

- Redesigned training navigation and lesson layouts for light/dark mode, keyboard access,
  and mobile use; removed visible XP, streaks, leaderboard, badges, and confetti.
- Added lesson guides, reading resume, self-review, field-library search/bookmarks,
  photo comparisons, and automatic captions/transcripts for 12 training videos.
- Added persisted coaching assignments and practice reviews, plus a structured lesson
  editor with saved drafts and atomic publishing.
- Rebuilt inspection role-play at rookie/easy with a matching scenario, voice transcript,
  evidence-based AI debrief, same-scenario retries, local history, and confirmed saves.
- Improved asset caching and reduced logo download size.

Database changes are additive and run through the existing startup migration path.
Existing exam content, completion requirements, and training records are preserved.
Automatic captions and existing insurance statements still require content-owner review.
