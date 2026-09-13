import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';

// Explicitly local, disposable test database. Never inherit the app's DATABASE_URL.
process.env.DATABASE_URL='postgresql://lite_test@127.0.0.1:55439/postgres';
process.env.DATABASE_SSL='false';
process.env.NODE_ENV='production';
const {pool,initDatabase}=await import('../dist-server/db/connection.js');
const {createLessonDraft,publishLessonDraft}=await import('../dist-server/lib/lesson-versions.js');
const {workspaceSchema}=await import('../dist-server/db/workspace-schema.js');
await initDatabase();
await pool.query(workspaceSchema); // Idempotent upgrade check.
const rep=randomUUID(),manager=randomUUID(),other=randomUUID(),module='test-'+randomUUID().slice(0,8);
const app=express();app.use(express.json());app.use('/api/coaching',(await import('../dist-server/routes/coaching.js')).default);
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}/api/coaching`;
async function call(path,token,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
try {
  for(const [id,isManager] of [[rep,false],[manager,true],[other,false]]){
    await pool.query('INSERT INTO users(id,name,is_manager) VALUES($1,$2,$3)',[id,'Workspace QA '+id,isManager]);
    await pool.query("INSERT INTO sessions(user_id,token,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",[id,id]);
  }
  assert.equal((await call('/practice',rep,{module:'inspection-process',section:'Photo documentation',anchor:'lesson-section-1',status:'needs_practice'})).status,200);
  assert.equal((await call(`/users/${rep}`,manager)).data.practice[0].status,'needs_practice');
  const assigned=await call('/assignments',manager,{userId:rep,module:'inspection-process',note:'Review the close-up and overview example.'});
  assert.equal(assigned.status,201);const id=assigned.data.assignment.id;
  assert.equal((await call('/mine',rep)).data.assignments[0].note,'Review the close-up and overview example.');
  assert.equal((await call('/mine',other)).data.assignments.length,0);
  assert.equal((await call(`/users/${rep}`,other)).status,403);
  assert.equal((await call(`/assignments/${id}/review`,other,{})).status,404);
  assert.equal((await call(`/assignments/${id}/review`,rep,{})).status,200);
  assert.equal((await call(`/users/${rep}`,manager)).data.assignments[0].status,'reviewed');
  assert.equal((await call('/practice',rep,{module:'inspection-process',section:'Photo documentation',anchor:'lesson-section-1',status:'ready'})).status,200);
  assert.equal((await call(`/users/${rep}`,manager)).data.practice[0].status,'ready');
  await pool.query('INSERT INTO cms_modules(id,title,order_index) VALUES($1,$2,99)',[module,'Local version test']);
  const one=await createLessonDraft(pool,module,'<h1>Original lesson</h1>');await publishLessonDraft(pool,module,one);
  const versions=await Promise.all([createLessonDraft(pool,module,'<h1>Draft two</h1>'),createLessonDraft(pool,module,'<h1>Draft three</h1>')]);
  assert.deepEqual([...versions].sort(),[2,3]);
  await assert.rejects(publishLessonDraft(pool,module,999));
  assert.equal((await pool.query("SELECT version FROM cms_module_content WHERE module_id=$1 AND status='published'",[module])).rows[0].version,1);
  await publishLessonDraft(pool,module,3);
  assert.equal((await pool.query("SELECT version FROM cms_module_content WHERE module_id=$1 AND status='published'",[module])).rows[0].version,3);
  assert.equal((await pool.query('SELECT COUNT(*) FROM exam_attempts WHERE user_id=$1',[rep])).rows[0].count,'0');
  console.log('PASS: durable practice upsert, manager assignment, rep read/review, record isolation, unchanged exam attempts, concurrent drafts, invalid-publish rollback, atomic publish, idempotent schema.');
} finally {
  await pool.query('DELETE FROM cms_modules WHERE id=$1',[module]);
  await pool.query('DELETE FROM coaching_assignments WHERE manager_id=$1',[manager]);
  await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[rep,manager,other]]);
  server.close();await pool.end();
}
