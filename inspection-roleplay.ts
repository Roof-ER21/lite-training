import { InspectionSession, type InspectionRecord } from './inspection-session';
import { connectInspection, inspectionRequest } from './inspection-live';
import { normalizeInspectionFeedback, type InspectionScenario } from './server/lib/inspection-contract';
import { escapeText } from './learning-workspace';
import { announceTrainingStatus } from './training-ui';
import './inspection-roleplay.css';

export function mountInspectionRoleplay(root:HTMLElement,scenarios:InspectionScenario[],complete:()=>void,review:()=>void):()=>void {
  const valid=scenarios.filter(s=>s?.id?.startsWith('insp-') && s.prompt && s.expectedKeyPoints?.length);
  root.innerHTML=`<div class="content-card inspection-practice"><p class="eyebrow">Inspection process · Rookie / Easy</p><h1>Practice the inspection conversation</h1><p>Explain the process to a patient homeowner. Take your time, ask questions, and practice one point at a time.</p><section class="inspection-brief"><h2>Your inspection scenario</h2><p id="inspection-prompt"></p><h3>What to cover</h3><ul id="inspection-points"></ul><p>Voice only. Your microphone is used while practicing; no camera is needed. A written transcript supports your feedback and saved practice record.</p><div class="inspection-actions"><button type="button" id="inspection-start" class="primary-action">Start voice practice</button><button type="button" id="inspection-next">Another inspection scenario</button><button type="button" id="inspection-review">Review inspection lesson</button></div></section><p id="inspection-state" role="status" aria-live="polite"></p><div class="inspection-actions" id="inspection-live-controls" hidden><button type="button" id="inspection-mute" aria-pressed="false">Mute microphone</button><button type="button" id="inspection-end">End & review</button><button type="button" id="inspection-cancel">Stop practice</button></div><section id="inspection-transcript-panel" hidden><h2>Your conversation</h2><p>Automatic speech transcription can contain errors. Feedback uses the words captured here.</p><div id="inspection-transcript" role="log" aria-label="Inspection conversation" aria-live="polite"></div></section><section id="inspection-debrief" hidden><h2>Your practice debrief</h2><div id="inspection-feedback"></div><p id="inspection-save-status" role="status"></p><div class="inspection-actions"><button type="button" id="inspection-feedback-retry">Retry feedback</button><button type="button" id="inspection-save-retry">Retry server save</button><button type="button" id="inspection-again">Practice this scenario again</button><button type="button" id="inspection-download">Download conversation</button></div></section><details class="inspection-history"><summary>Practice saved on this device</summary><div id="inspection-history"></div></details></div>`;
  if(!valid.length){root.querySelector('#inspection-state')!.textContent='Inspection scenarios could not load. Refresh to retry.';root.querySelectorAll('button').forEach(b=>b.disabled=true);return ()=>{};}
  const storageKey=`roof-er.inspectionPractice.${localStorage.getItem('roof-er.userId') || 'local'}`;
  let localAvailable=true,disposed=false,index=0;let history:InspectionRecord[]=[];
  try{const parsed=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(parsed))history=parsed.filter(r=>r?.id&&r.scenario?.id&&Array.isArray(r.transcript));}catch{}
  let flow:InspectionSession;
  const persist=()=>{if(!flow.record)return;history=[flow.record,...history.filter(r=>r.id!==flow.record!.id)];try{localStorage.setItem(storageKey,JSON.stringify(history));localAvailable=true;}catch{localAvailable=false;}};
  const button=(id:string)=>root.querySelector<HTMLButtonElement>('#'+id)!;
  const updateHistory=()=>{
    const list=root.querySelector('#inspection-history')!;list.replaceChildren();
    for(const record of history){const item=document.createElement('button');item.type='button';item.textContent=`${new Date(record.startedAt).toLocaleString()} · ${record.completed?'Finished':'Interrupted'} · ${record.scenario.prompt}`;
      item.disabled=['connecting','practicing','scoring'].includes(flow.phase);
      item.onclick=()=>{flow.dispose();flow=makeFlow(record.scenario);flow.restore(record);};list.append(item);}
    if(!history.length)list.textContent='Completed and interrupted conversations will appear here.';
  };
  let lastTranscript='',lastFeedback='';
  const update=()=>{
    if(disposed)return;persist();
    const phase=flow.phase,active=['connecting','practicing','scoring'].includes(phase);
    root.querySelector('#inspection-state')!.textContent=flow.message || 'Ready when you are.';
    root.querySelector('#inspection-prompt')!.textContent=flow.scenario.prompt;
    root.querySelector('#inspection-points')!.innerHTML=flow.scenario.expectedKeyPoints.map(point=>`<li>${escapeText(point)}</li>`).join('');
    button('inspection-start').disabled=active;button('inspection-start').textContent=phase==='ready'?'Start voice practice':'Retry same scenario';
    button('inspection-next').disabled=active;button('inspection-review').disabled=phase==='scoring';
    const controls=root.querySelector<HTMLElement>('#inspection-live-controls')!;controls.hidden=!active && phase!=='interrupted';
    button('inspection-mute').disabled=phase!=='practicing';button('inspection-mute').textContent=flow.muted?'Unmute microphone':'Mute microphone';button('inspection-mute').setAttribute('aria-pressed',String(flow.muted));
    button('inspection-end').disabled=!['practicing','interrupted'].includes(phase);button('inspection-cancel').disabled=phase==='scoring';
    const transcript=flow.record?.transcript || [];root.querySelector<HTMLElement>('#inspection-transcript-panel')!.hidden=!transcript.length;
    const serialized=JSON.stringify(transcript);
    if(serialized!==lastTranscript){lastTranscript=serialized;root.querySelector('#inspection-transcript')!.innerHTML=transcript.map(turn=>`<p><strong>${turn.role==='user'?'You':'Agnes'}</strong> ${escapeText(turn.text)}</p>`).join('');}
    root.querySelector<HTMLElement>('#inspection-debrief')!.hidden=phase!=='completed';
    const feedback=flow.record?.feedback;const signature=JSON.stringify(feedback);
    if(signature!==lastFeedback){lastFeedback=signature;root.querySelector('#inspection-feedback')!.innerHTML=feedback?`<p><strong>AI-scored practice: ${feedback.score}/100</strong></p><p>${escapeText(feedback.summary)}</p>${feedback.criteria.map(c=>`<article class="inspection-criterion"><h3>${escapeText(c.point)}</h3><p><strong>${c.status==='covered'?'Covered':c.status==='partial'?'Partly covered':'Not yet covered'}</strong></p>${c.evidence?`<blockquote>“${escapeText(c.evidence)}”</blockquote>`:''}<p>${escapeText(c.nextStep)}</p></article>`).join('')}`:'<p>No AI score is available. Review your transcript against the preparation points above, or retry feedback. </p>';}
    root.querySelector('#inspection-save-status')!.textContent=flow.saving?'Saving your conversation and feedback…':flow.saved?'Conversation and feedback saved to your training record.':localAvailable?'Saved on this device. Server save is not confirmed. Retry when connected.':'Browser storage is unavailable. Download this conversation before leaving.';
    button('inspection-feedback-retry').hidden=!!feedback;button('inspection-feedback-retry').disabled=flow.saving;button('inspection-save-retry').hidden=flow.saved;button('inspection-save-retry').disabled=flow.saving;
    updateHistory();
  };
  const makeFlow=(scenario:InspectionScenario)=>new InspectionSession(scenario,{
    connect:connectInspection,
    feedback:async(record,signal)=>{const data=await inspectionRequest('/ai/inspection-feedback',{scenario:record.scenario,transcript:record.transcript},signal);return normalizeInspectionFeedback(data.feedback,record.scenario,record.transcript);},
    save:async(record,signal)=>{const result=await inspectionRequest('/roleplay/inspection-save',record,signal);if(result.sessionId!==record.id)throw Error('Session save was not confirmed.');},
    changed:update,completed:()=>{complete();announceTrainingStatus('Inspection practice completed. Review your feedback below.');}
  });
  flow=makeFlow(valid[0]);update();
  button('inspection-start').onclick=()=>void flow.start();
  button('inspection-again').onclick=()=>void flow.start();
  button('inspection-next').onclick=()=>{flow.dispose();index=(index+1)%valid.length;flow=makeFlow(valid[index]);update();};
  button('inspection-review').onclick=review;
  button('inspection-end').onclick=()=>void flow.finish();
  button('inspection-mute').onclick=()=>flow.toggleMute();
  button('inspection-cancel').onclick=()=>flow.stop();
  button('inspection-feedback-retry').onclick=()=>void flow.retryFeedback();
  button('inspection-save-retry').onclick=()=>void flow.retrySave();
  button('inspection-download').onclick=()=>{
    if(!flow.record)return;
    const blob=new Blob([JSON.stringify(flow.record,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='inspection-practice-'+flow.record.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return ()=>{persist();disposed=true;flow.dispose();};
}
