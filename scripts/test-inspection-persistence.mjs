import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
process.env.DATABASE_URL='postgresql://lite_test@127.0.0.1:55439/postgres';
process.env.DATABASE_SSL='false';process.env.NODE_ENV='production';
const {pool,initDatabase}=await import('../dist-server/db/connection.js');
const {inspectionSchema}=await import('../dist-server/db/inspection-schema.js');
await initDatabase();
const rep=randomUUID(),other=randomUUID(),legacy=randomUUID(),id=randomUUID();
const app=express();app.use(express.json());app.use('/api/roleplay',(await import('../dist-server/routes/roleplay.js')).default);
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
async function call(path,token,body){const r=await fetch(`http://127.0.0.1:${server.address().port}/api/roleplay`+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
try{
 for(const user of [rep,other]){await pool.query('INSERT INTO users(id,name) VALUES($1,$2)',[user,'Inspection local QA '+user]);await pool.query("INSERT INTO sessions(user_id,token,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",[user,user]);}
 await pool.query("INSERT INTO roleplay_sessions(id,user_id,personality,difficulty,input_mode,final_score) VALUES($1,$2,'legacy','BEGINNER','voice',75)",[legacy,rep]);
 await pool.query(inspectionSchema);await pool.query(inspectionSchema);
 assert.equal((await pool.query('SELECT final_score FROM roleplay_sessions WHERE id=$1',[legacy])).rows[0].final_score,75);
 const record={id,scenario:{id:'insp-local-qa',prompt:'How do you inspect?',expectedKeyPoints:['Document findings','Explain the photos']},difficulty:'BEGINNER',startedAt:new Date().toISOString(),transcript:[{role:'user',text:'I document findings and explain the photos.'},{role:'agnes',text:'Thank you.'}],feedback:null,completed:true};
 assert.equal((await call('/inspection-save',rep,record)).status,200);
 assert.equal((await call('/inspection-save',rep,record)).status,200);
 let row=(await pool.query('SELECT * FROM roleplay_sessions WHERE id=$1',[id])).rows[0];assert.equal(row.final_score,null);assert.deepEqual(JSON.parse(row.conversation_log).transcript,record.transcript);
 record.feedback={summary:'Practice the explanation again.',criteria:[{status:'covered',evidence:'document findings',nextStep:'Keep documenting.'},{status:'partial',evidence:'explain the photos',nextStep:'Explain what the photos show.'}]};
 assert.equal((await call('/inspection-save',rep,record)).status,200);assert.equal((await call('/inspection-save',rep,record)).status,200);
 assert.equal((await pool.query('SELECT count(*) FROM roleplay_sessions WHERE id=$1',[id])).rows[0].count,'1');
 const detail=await call('/session/'+id,rep);assert.equal(detail.status,200);assert.equal(detail.data.session.finalScore,75);assert.equal(detail.data.scores.length,2);assert.equal(detail.data.session.xpEarned,0);
 assert.equal((await call('/inspection-save',other,record)).status,409);assert.equal((await call('/session/'+id,other)).status,403);
 assert.equal((await pool.query('SELECT count(*) FROM exam_attempts WHERE user_id=$1',[rep])).rows[0].count,'0');
 console.log('PASS: unscored null, captured transcript readback, same-ID feedback and save retries, two nonduplicated criteria, record isolation, legacy row preserved, repeated additive migration, no XP or exam writes.');
}finally{await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[rep,other]]);server.close();await pool.end();}
