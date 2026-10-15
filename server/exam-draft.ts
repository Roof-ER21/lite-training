export function validExamDraft(draft: any): boolean {
  if (!draft || typeof draft !== 'object' || typeof draft.saveId !== 'string' || draft.saveId.length > 80 ||
      !Number.isFinite(draft.startedAt) || !draft.questions || !draft.answers || typeof draft.answers !== 'object' || Array.isArray(draft.answers)) return false;
  const keys = new Set<string>();
  for (const section of ['mcq', 'fib', 'sa']) {
    const questions = draft.questions[section];
    if (!Array.isArray(questions) || !questions.length || questions.length > 100) return false;
    if (!questions.every(q => q && typeof q.id === 'string')) return false;
    questions.forEach((_: unknown, i: number) => keys.add(`${section}-${i}`));
  }
  return Object.entries(draft.answers).every(([key, value]) => keys.has(key) && typeof value === 'string' && value.length <= 20000) &&
    (!draft.currentQuestion || keys.has(draft.currentQuestion)) && JSON.stringify(draft).length <= 200000;
}

export function examProgress(attempt: any) {
  if (!attempt) return null;
  const draft = attempt.draft;
  const sections = ['mcq', 'fib', 'sa'].map(section => ({
    section,
    total: draft?.questions?.[section]?.length || 0,
    answered: (draft?.questions?.[section] || []).filter((_: unknown, i: number) =>
      String(draft?.answers?.[`${section}-${i}`] || '').trim().length > 0).length,
  }));
  return {
    attemptNumber: attempt.attempt_number,
    status: attempt.completed_at ? (attempt.passed ? 'passed' : 'submitted') : 'in_progress',
    score: attempt.completed_at ? attempt.total_score : null,
    startedAt: attempt.started_at,
    savedAt: attempt.draft_saved_at,
    completedAt: attempt.completed_at,
    currentQuestion: draft?.currentQuestion || null,
    answered: sections.reduce((n, s) => n + s.answered, 0),
    total: sections.reduce((n, s) => n + s.total, 0),
    sections,
  };
}
