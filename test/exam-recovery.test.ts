import {test, expect, afterAll} from 'vitest';
import pg from 'pg';
const db = new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
const user = process.env.TEST_TRAINEE_ID!;
async function post(path: string, body = {}, token = process.env.TEST_TRAINEE_TOKEN!) {
 const r = await fetch(process.env.TEST_BASE_URL + '/api/exam/' + path, {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ' + token},body:JSON.stringify(body)});
 return {status:r.status,body:await r.json()};
}
afterAll(() => db.end());
test('unfinished attempts resume, foreign submissions fail, saves roll back and retries are idempotent', async () => {
 await db.query('DELETE FROM certifications WHERE user_id = $1',[user]);
 await db.query('DELETE FROM exam_attempts WHERE user_id = $1',[user]);
 // Historical abandoned attempts must not lock a rep out.
 await db.query('INSERT INTO exam_attempts (user_id,attempt_number) VALUES ($1,1),($1,2),($1,3)',[user]);
 const starts = await Promise.all([post('start'),post('start'),post('start')]);
 expect(new Set(starts.map(r=>r.body.attemptId)).size).toBe(1);
 expect(starts[0].body.remainingAttempts).toBe(3);
 const attemptId=starts[0].body.attemptId;
 const payload={attemptId,timeTaken:25,results:{mcqCorrect:30,fibCorrect:8,saPoints:15,totalScore:84,passed:true},saAnswers:[{questionId:'sa1',questionNumber:1,questionText:'Test',userAnswer:'Answer',correctAnswer:'Answer',isCorrect:false,pointsEarned:1.4}]};
 expect((await post('submit',payload,process.env.TEST_MANAGER_TOKEN)).status).toBe(404);
 // Inject a database failure after result update: nothing may commit.
 await db.query("CREATE FUNCTION reject_test_certificate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$");
 await db.query('CREATE TRIGGER reject_test_certificate BEFORE INSERT ON certifications FOR EACH ROW EXECUTE FUNCTION reject_test_certificate()');
 try {
  expect((await post('submit',payload)).status).toBe(500);
  expect((await db.query('SELECT completed_at FROM exam_attempts WHERE id=$1',[attemptId])).rows[0].completed_at).toBeNull();
  expect((await db.query('SELECT * FROM exam_answers WHERE attempt_id=$1',[attemptId])).rowCount).toBe(0);
 } finally { await db.query('DROP TRIGGER reject_test_certificate ON certifications; DROP FUNCTION reject_test_certificate()'); }
 const saved=await Promise.all([post('submit',payload),post('submit',payload)]);
 expect(saved.every(r=>r.status===200 && r.body.passed)).toBe(true);
 expect((await db.query('SELECT * FROM exam_answers WHERE attempt_id=$1',[attemptId])).rowCount).toBe(1);
 expect((await db.query('SELECT * FROM certifications WHERE user_id=$1',[user])).rowCount).toBe(1);
 const replay=await post('submit',{...payload,results:{...payload.results,totalScore:20,passed:false}});
 expect(replay.body.score).toBe(84);
 const cert=await fetch(process.env.TEST_BASE_URL+'/api/certificates/me',{headers:{Authorization:'Bearer '+process.env.TEST_TRAINEE_TOKEN}});
 expect(cert.status).toBe(200);
 expect((await post('start')).status).toBe(409);
});

test('only three completed failures cause lockout',async()=>{
 const token=process.env.TEST_MANAGER_TOKEN!;
 for(let i=0;i<3;i++) {
  const started=await post('start',{},token);
  expect(started.body.remainingAttempts).toBe(3-i);
  const payload={attemptId:started.body.attemptId,timeTaken:10,results:{mcqCorrect:0,fibCorrect:0,saPoints:0,totalScore:0,passed:false}};
  const saved=await post('submit',payload,token);
  expect(saved.body.remainingAttempts).toBe(2-i);
  expect((await post('submit',payload,token)).body.remainingAttempts).toBe(2-i);
 }
 expect((await post('start',{},token)).status).toBe(409);
});
