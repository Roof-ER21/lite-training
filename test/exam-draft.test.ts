import { test, expect, afterAll } from 'vitest';
import pg from 'pg';
const db = new pg.Pool({connectionString: process.env.TEST_DATABASE_URL});
afterAll(() => db.end());
async function request(path: string, body?: any, manager = false) {
  const response = await fetch(`${process.env.TEST_BASE_URL}/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${manager ? process.env.TEST_MANAGER_TOKEN : process.env.TEST_TRAINEE_TOKEN}`},
    body: body ? JSON.stringify(body) : undefined,
  });
  return {status: response.status, body: await response.json()};
}

test('drafts persist without consuming attempts, resume, reject stale writes and appear only to managers', async () => {
  const user = process.env.TEST_TRAINEE_ID;
  await db.query('DELETE FROM certifications WHERE user_id=$1', [user]);
  await db.query('DELETE FROM exam_attempts WHERE user_id=$1', [user]);
  const started = await request('exam/start', {});
  const attemptId = started.body.attemptId;
  const draft = {saveId: 'first-save', startedAt: Date.now(), questions: {
    mcq: [{id: 'mcq-1'}, {id: 'mcq-2'}], fib: [{id: 'fib-1'}], sa: [{id: 'sa-1'}],
  }, answers: {'mcq-0': '0', 'fib-0': 'roof', 'sa-0': '  '}, currentQuestion: 'fib-0'};
  const payload = {attemptId, revision: 0, draft};
  expect((await request('exam/draft', payload, true)).status).toBe(409);
  expect((await request('exam/draft', {...payload, draft: {...draft, answers: {bad: 'answer'}}})).status).toBe(400);
  const saved = await request('exam/draft', payload);
  expect(saved.body.revision).toBe(1);
  expect(saved.body.savedAt).toBeTruthy();
  expect((await request('exam/draft', payload)).body.revision).toBe(1);
  expect((await request('exam/draft', {...payload, draft: {...draft, saveId: 'stale'}})).body.conflict).toBe(true);
  const resumed = await request('exam/start', {});
  expect(resumed.body).toMatchObject({attemptId, remainingAttempts: 3, draft, revision: 1});
  expect((await request('exam/draft')).body.draft).toEqual(draft);
  expect((await request('exam/draft', undefined, true)).body.draft).toBeNull();
  expect((await request('admin/progress-grid')).status).toBe(403);
  let grid = await request('admin/progress-grid', undefined, true);
  expect(grid.body.userProgress.find((u: any) => u.userId === user).exam).toMatchObject({
    status: 'in_progress', answered: 2, total: 4, currentQuestion: 'fib-0', attemptNumber: 1,
  });
  // Competing tabs using the same revision: exactly one may replace the saved snapshot.
  const competing = await Promise.all(['a', 'b'].map(saveId => request('exam/draft', {attemptId, revision: 1, draft: {...draft, saveId}})));
  expect(competing.filter(r => r.body.success)).toHaveLength(1);
  expect(competing.filter(r => r.body.conflict)).toHaveLength(1);
  await request('exam/submit', {attemptId, timeTaken: 10, results: {mcqCorrect: 0, fibCorrect: 0, saPoints: 0, totalScore: 0, passed: false}});
  expect((await request('exam/draft', {attemptId, revision: 2, draft: {...draft, saveId: 'late'}})).status).toBe(409);
  expect((await request('exam/draft')).body.draft).toBeNull();
  grid = await request('admin/progress-grid', undefined, true);
  expect(grid.body.userProgress.find((u: any) => u.userId === user).exam.status).toBe('submitted');
});

test('opening an unlocked lesson records its current progress without reopening completed work', async () => {
  await request('progress/module', {moduleName: 'welcome', action: 'start'});
  const progress = await request('progress');
  expect(progress.body.modules.find((m: any) => m.name === 'welcome').status).toBe('in_progress');
  await request('progress/module', {moduleName: 'welcome', action: 'complete'});
  await request('progress/module', {moduleName: 'welcome', action: 'start'});
  expect((await request('progress')).body.modules.find((m: any) => m.name === 'welcome').status).toBe('completed');
});
