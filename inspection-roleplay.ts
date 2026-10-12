import { InspectionSession, type InspectionRecord } from './inspection-session';
import { connectInspection, inspectionRequest } from './inspection-live';
import { normalizeInspectionFeedback, type InspectionScenario } from './server/lib/inspection-contract';
import { escapeText } from './learning-workspace';
import { announceTrainingStatus } from './training-ui';
import './inspection-roleplay.css';
import { checkMicrophone, playSpeakerCheck } from './inspection-audio-check';

export function mountInspectionRoleplay(root:HTMLElement,scenarios:InspectionScenario[],complete:()=>void,review:()=>void):()=>void {
  const valid=scenarios.filter(s=>s?.id?.startsWith('insp-') && s.prompt && s.expectedKeyPoints?.length);
  root.innerHTML=`<div class="content-card inspection-practice"><p class="eyebrow">Inspection process · Rookie / Easy</p><h1>Practice the inspection conversation</h1><p>Explain the process to a patient homeowner. Take your time, ask questions, and practice one point at a time.</p><section class="inspection-brief"><h2>Your inspection scenario</h2><p id="inspection-prompt"></p><h3>What to cover</h3><ul id="inspection-points"></ul><p>Choose voice or typed practice. Both use the same inspection scenario and feedback. Voice uses your microphone; no camera is needed. Check your sound first, then start your conversation.</p><div class="inspection-audio-check"><p>Sound check stays on this device and does not contact Agnes.</p><div class="inspection-actions"><button type="button" id="inspection-check">Check microphone</button><button type="button" id="inspection-speaker">Play test sound</button></div><label for="inspection-level">Microphone level</label><meter id="inspection-level" min="0" max="1" value="0">Microphone level</meter><p id="inspection-audio-status" role="status">Speak during the check to see the level move. If the test sound is silent, check your volume and audio output.</p></div><div class="inspection-actions"><button type="button" id="inspection-start" class="primary-action">Start voice practice</button><button type="button" id="inspection-type">Use typed practice</button><button type="button" id="inspection-next">Another inspection scenario</button><button type="button" id="inspection-review">Review inspection lesson</button></div></section><p id="inspection-state" role="status" aria-live="polite"></p><div class="inspection-actions" id="inspection-live-controls" hidden><button type="button" id="inspection-mute" aria-pressed="false">Mute microphone</button><button type="button" id="inspection-end">End & review</button><button type="button" id="inspection-cancel">Stop practice</button><button type="button" id="inspection-switch">Switch to typing</button></div><section id="inspection-transcript-panel" hidden><h2>Your conversation</h2><p>Automatic speech transcription can contain errors. Feedback uses the words captured here.</p><div id="inspection-transcript" role="log" aria-label="Inspection conversation" aria-live="polite"></div></section><form id="inspection-text-form" hidden><label for="inspection-text">Your reply to Agnes</label><textarea id="inspection-text" rows="3" maxlength="4000" required></textarea><div class="inspection-actions"><button type="submit" id="inspection-send">Send reply</button><button type="button" id="inspection-reply-retry" hidden>Retry Agnes’s reply</button></div><p>Your typed words are included in your saved practice and AI feedback.</p></form><section id="inspection-debrief" hidden><h2>Your practice debrief</h2><div id="inspection-feedback"></div><p id="inspection-save-status" role="status"></p><div class="inspection-actions"><button type="button" id="inspection-feedback-retry">Retry feedback</button><button type="button" id="inspection-save-retry">Retry server save</button><button type="button" id="inspection-again">Practice this scenario again</button><button type="button" id="inspection-download">Download conversation</button><button type="button" id="inspection-continue" class="primary-action">Next: Final Exam</button></div></section><details class="inspection-history"><summary>Practice saved on this device</summary><div id="inspection-history"></div></details></div>`;
  if(!valid.length){root.querySelector('#inspection-state')!.textContent='Inspection scenarios could not load. Refresh to retry.';root.querySelectorAll('button').forEach(b=>b.disabled=true);return ()=>{};}
  const storageKey=`roof-er.inspectionPractice.${localStorage.getItem('roof-er.userId') || 'local'}`;
  let localAvailable=true,disposed=false,index=0;let history:InspectionRecord[]=[];
  try{const parsed=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(parsed))history=parsed.filter(r=>r?.id&&r.scenario?.id&&Array.isArray(r.transcript));}catch{}
  let flow:InspectionSession;
  let audioController=new AbortController(),checking=false,audioTimer:ReturnType<typeof setTimeout>|undefined;
  let speechTimer:ReturnType<typeof setTimeout>|undefined,previousPhase='';
  const audioStatus=root.querySelector<HTMLElement>('#inspection-audio-status')!;
  const stopCheck=()=>{audioController.abort();audioController=new AbortController();checking=false;clearTimeout(audioTimer);};
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
    button('inspection-type').disabled=phase==='scoring' || (phase==='practicing' && flow.typing);
    button('inspection-type').textContent=phase==='interrupted'?'Continue by typing':'Use typed practice';
    button('inspection-check').disabled=active;button('inspection-speaker').disabled=active;
    button('inspection-check').textContent=checking?'Stop microphone check':'Check microphone';
    root.querySelector<HTMLFormElement>('#inspection-text-form')!.hidden=!flow.typing || phase!=='practicing';
    button('inspection-send').disabled=flow.replying || flow.replyFailed;
    button('inspection-reply-retry').hidden=!flow.replyFailed;button('inspection-reply-retry').disabled=flow.replying;
    root.querySelector<HTMLTextAreaElement>('#inspection-text')!.disabled=flow.replying || flow.replyFailed;
    if(previousPhase!==phase){
      previousPhase=phase;clearTimeout(speechTimer);
      if(['connecting','practicing','completed'].includes(phase))requestAnimationFrame(()=>{
        if(disposed || flow.phase!==phase)return;
        const target=root.querySelector<HTMLElement>(phase==='completed'?'#inspection-debrief':'#inspection-state');
        target?.scrollIntoView({block:'start',behavior:'instant'});
      });
      if(phase==='practicing' && !flow.typing)speechTimer=setTimeout(()=>{
        if(flow.phase==='practicing' && !flow.typing && !flow.record?.transcript.some(t=>t.role==='user')){
          root.querySelector('#inspection-state')!.textContent='No words from you have been captured yet. Speak a short sentence. If nothing appears below, stop and check your microphone or continue by typing.';
        }
      },15000);
    }
    button('inspection-next').disabled=active;button('inspection-review').disabled=phase==='scoring';
    const controls=root.querySelector<HTMLElement>('#inspection-live-controls')!;controls.hidden=!active && phase!=='interrupted';
    button('inspection-mute').hidden=flow.typing;button('inspection-mute').disabled=phase!=='practicing';button('inspection-mute').textContent=flow.muted?'Unmute microphone':'Mute microphone';button('inspection-mute').setAttribute('aria-pressed',String(flow.muted));
    button('inspection-switch').hidden=flow.typing;button('inspection-switch').disabled=phase==='scoring';
    button('inspection-continue').disabled=flow.saving;
    button('inspection-end').disabled=!['practicing','interrupted'].includes(phase) || flow.replying;button('inspection-cancel').disabled=phase==='scoring';
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
    reply:async(record,signal)=>{const data=await inspectionRequest('/ai/inspection-reply',{scenario:record.scenario,transcript:record.transcript},signal);if(typeof data.reply!=='string')throw Error('No reply received.');return data.reply;},
    feedback:async(record,signal)=>{const data=await inspectionRequest('/ai/inspection-feedback',{scenario:record.scenario,transcript:record.transcript},signal);return normalizeInspectionFeedback(data.feedback,record.scenario,record.transcript);},
    save:async(record,signal)=>{const result=await inspectionRequest('/roleplay/inspection-save',record,signal);if(result.sessionId!==record.id)throw Error('Session save was not confirmed.');},
    changed:update,completed:()=>{complete();announceTrainingStatus('Inspection practice completed. Review your feedback below.');}
  });
  flow=makeFlow(valid[0]);update();
  button('inspection-start').onclick=()=>{stopCheck();void flow.start();};
  button('inspection-again').onclick=()=>{stopCheck();if(flow.typing)flow.startText();else void flow.start();};
  button('inspection-type').onclick=()=>{stopCheck();if(['connecting','practicing'].includes(flow.phase))flow.stop();flow.startText();root.querySelector<HTMLTextAreaElement>('#inspection-text')!.focus();};
  button('inspection-switch').onclick=()=>button('inspection-type').click();
  button('inspection-continue').onclick=()=>{complete();document.getElementById('lesson-next')?.click();};
  const form=root.querySelector<HTMLFormElement>('#inspection-text-form')!;
  form.onsubmit=event=>{event.preventDefault();const input=root.querySelector<HTMLTextAreaElement>('#inspection-text')!;const text=input.value;if(!text.trim() || flow.replying || flow.replyFailed)return;input.value='';void flow.sendText(text).then(()=>{if(!disposed && flow.phase==='practicing' && !flow.replyFailed)input.focus();});};
  button('inspection-reply-retry').onclick=()=>void flow.retryReply();
  button('inspection-check').onclick=async()=>{
    if(checking){stopCheck();audioStatus.textContent='Microphone check stopped. Start voice or typed practice when ready.';update();return;}
    stopCheck();checking=true;update();const signal=audioController.signal;let detected=false;
    audioStatus.textContent='Allow microphone access, then say a sentence. The check stops after ten seconds.';
    try{
      await checkMicrophone(signal,level=>{if(disposed)return;root.querySelector<HTMLMeterElement>('#inspection-level')!.value=level;if(level>0.03)detected=true;});
      if(signal.aborted)return;
      audioTimer=setTimeout(()=>{stopCheck();audioStatus.textContent=detected?'Microphone detected sound. If you heard the test tone, you are ready for voice practice.':'No microphone sound detected. Check your selected microphone and mute switch, or use typed practice.';update();},10000);
    }catch(error){if(signal.aborted)return;stopCheck();audioStatus.textContent=(error as Error).name==='NotAllowedError'?'Microphone permission was denied. Allow access in browser settings, or use typed practice.':(error as Error).message;update();}
  };
  button('inspection-speaker').onclick=()=>{const signal=audioController.signal;void playSpeakerCheck(signal).then(()=>{if(!disposed&&!signal.aborted)audioStatus.textContent='A short tone was played. If you did not hear it, check your volume and selected audio output, or use typed practice.';}).catch(()=>{if(!disposed)audioStatus.textContent='Sound could not play. Check your audio output or use typed practice.';});};
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
  return ()=>{persist();disposed=true;stopCheck();clearTimeout(speechTimer);flow.dispose();};
}
