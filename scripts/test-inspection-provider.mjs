import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {GoogleGenAI} from '@google/genai';
process.env.DATABASE_URL='postgresql://lite_test@127.0.0.1:55439/postgres';process.env.DATABASE_SSL='false';process.env.NODE_ENV='production';
const {pool,initDatabase}=await import('../dist-server/db/connection.js');
const {inspectionInstruction,appendInspectionTurn}=await import('../dist-server/lib/inspection-contract.js');
await initDatabase();const rep=randomUUID();let session;
const app=express();app.use(express.json());app.use('/api/ai',(await import('../dist-server/routes/ai.js')).default);
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
async function call(path,body){const r=await fetch(`http://127.0.0.1:${server.address().port}/api/ai/`+path,{method:'POST',headers:{Authorization:'Bearer '+rep,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok)throw Error('Provider endpoint '+path+' returned '+r.status);return data;}
const scenario={id:'insp-1',prompt:'What exactly are you looking for up there on my roof?',expectedKeyPoints:['Hail/storm damage indicators','Granule loss and bruising on shingles','Flashing and vent condition','Collateral damage evidence']};
const transcript=[];let audioParts=0,ready=false,turns=0,closeCode=null,providerError=false;
async function waitUntil(check,ms=20000){const start=Date.now();while(!check()){if(Date.now()-start>ms)throw Error('Provider response timed out');await new Promise(r=>setTimeout(r,100));}}
try{
 await pool.query('INSERT INTO users(id,name) VALUES($1,$2)',[rep,'Synthetic inspection provider QA']);await pool.query("INSERT INTO sessions(user_id,token,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",[rep,rep]);
 const token=await call('gemini-token',{inspection:true,systemInstruction:inspectionInstruction(scenario)});
 const ai=new GoogleGenAI({apiKey:token.token,httpOptions:{apiVersion:'v1alpha'}});
 session=await ai.live.connect({model:token.model,callbacks:{onmessage:m=>{if(m.setupComplete)ready=true;const c=m.serverContent;if(!c)return;for(const [role,key] of [['user','inputTranscription'],['agnes','outputTranscription']])if(c[key]?.text)appendInspectionTurn(transcript,role,c[key].text);audioParts+=(c.modelTurn?.parts||[]).filter(p=>p.inlineData?.data).length;if(c.turnComplete)turns++;},onerror:()=>{providerError=true;},onclose:e=>{closeCode=e.code;}}});
 await waitUntil(()=>ready);
 session.sendClientContent({turns:[{role:'user',parts:[{text:'Begin the supplied rookie inspection scenario with its exact opening question.'}]}],turnComplete:true});
 await waitUntil(()=>turns>0);
 const pcm=await readFile('/private/tmp/lite-inspection-speech.pcm');assert.ok(pcm.length>32000,'Synthetic speech fixture must contain audio');
 for(let i=0;i<pcm.length;i+=3200){session.sendRealtimeInput({audio:{data:pcm.subarray(i,i+3200).toString('base64'),mimeType:'audio/pcm;rate=16000'}});await new Promise(r=>setTimeout(r,100));}
 session.sendRealtimeInput({audioStreamEnd:true});await waitUntil(()=>turns>1&&transcript.some(t=>t.role==='user'));
 session.close();session=null;assert.ok(audioParts>0);assert.ok(transcript.some(t=>t.role==='agnes'));
 const feedback=await call('inspection-feedback',{scenario,transcript});assert.equal(feedback.aiScored,true);assert.equal(feedback.feedback.criteria.length,4);
 console.log(JSON.stringify({result:'PASS',syntheticAudio:true,liveAudioParts:audioParts,repTranscriptionEvents:transcript.filter(t=>t.role==='user').length,homeownerTranscriptionEvents:transcript.filter(t=>t.role==='agnes').length,feedbackCriteria:feedback.feedback.criteria.length,score:feedback.feedback.score}));
}catch(e){console.error(JSON.stringify({error:e.message,ready,turns,audioParts,closeCode,providerError,repEvents:transcript.filter(t=>t.role==='user').length}));process.exitCode=1;}
finally{session?.close();await pool.query('DELETE FROM users WHERE id=$1',[rep]);server.close();await pool.end();}
