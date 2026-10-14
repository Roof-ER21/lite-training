import { InspectionSession, type InspectionRecord } from './inspection-session';
import { connectInspection, inspectionRequest } from './inspection-live';
import { INITIAL_PITCH_SCENARIO, normalizeInspectionFeedback, type InspectionScenario } from './server/lib/inspection-contract';
import { escapeText } from './learning-workspace';
import { announceTrainingStatus } from './training-ui';
import './inspection-roleplay.css';
import { checkMicrophone, playSpeakerCheck } from './inspection-audio-check';

export function mountInspectionRoleplay(root:HTMLElement,complete:()=>void,review:()=>void):()=>void {
  root.innerHTML=`<div class="inspection-practice doorstep-practice">
    <header class="doorstep-hero">
      <div><p class="doorstep-kicker">Module 13 / AI role-play</p><h1>The door opens.<br>Your pitch starts.</h1><p>One doorstep. A real back-and-forth. Practice your pitch and handle a simple objection.</p></div>
      <div class="doorstep-hero-note"><span>THE GOAL</span><strong>Earn the<br>inspection.</strong><p>Agnes plays the homeowner.<br>You take the lead.</p></div>
    </header>
    <div class="doorstep-workspace">
      <section class="inspection-brief doorstep-stage" aria-labelledby="doorstep-title">
        <div class="doorstep-stage-heading"><span class="doorstep-kicker">At the front door</span><span class="doorstep-level">Rookie / Easy</span></div>
        <div class="doorstep-homeowner"><span class="doorstep-avatar" aria-hidden="true">A</span><div><h2 id="doorstep-title">Meet Agnes</h2><p>Your AI homeowner</p></div></div>
        <p class="doorstep-context">You’ve just knocked. Agnes opens the door.</p>
        <blockquote id="inspection-prompt"></blockquote>
        <p class="doorstep-direction">Run your initial pitch, listen to Agnes’s concern, and work toward permission to inspect. She’ll raise a simple objection and give you room to respond.</p>
        <div class="inspection-actions doorstep-start"><button type="button" id="inspection-start" class="primary-action">Start voice practice</button></div>
        <p class="doorstep-mode-note">Speak naturally and let Agnes respond. Microphone required; no camera needed.</p>
        <details class="inspection-audio-check"><summary>Check your microphone &amp; sound</summary><p>The sound check stays on this device.</p><div class="inspection-actions"><button type="button" id="inspection-check">Check microphone</button><button type="button" id="inspection-speaker">Play test sound</button></div><label for="inspection-level">Microphone level</label><meter id="inspection-level" min="0" max="1" value="0">Microphone level</meter><p id="inspection-audio-status" role="status">Speak during the check to see the level move. If the test sound is silent, check your volume and audio output.</p></details>
      </section>
      <aside class="doorstep-script" aria-labelledby="doorstep-script-title"><p class="doorstep-kicker">Your script guide</p><h2 id="doorstep-script-title">Make the first<br>impression count.</h2><p>Your script, one simple objection, and a clear next step.</p><ol id="inspection-points"></ol><button type="button" id="inspection-review">Review the initial script</button></aside>
    </div>
    <div class="doorstep-session">
      <p id="inspection-state" role="status" aria-live="polite"></p>
      <div class="inspection-actions" id="inspection-live-controls" hidden><button type="button" id="inspection-mute" aria-pressed="false">Mute microphone</button><button type="button" id="inspection-end" class="primary-action">End &amp; review</button><button type="button" id="inspection-cancel">Stop practice</button></div>
      <section id="inspection-transcript-panel" hidden><p class="doorstep-kicker">The conversation</p><h2>You &amp; Agnes</h2><p class="doorstep-mode-note">Feedback uses the words captured here. Automatic transcription can contain errors.</p><div id="inspection-transcript" role="log" aria-label="Doorstep conversation" aria-live="polite"></div></section>
      <section id="inspection-debrief" hidden><p class="doorstep-kicker">Your next rep starts here</p><h2>How your pitch landed</h2><div id="inspection-feedback"></div><p id="inspection-save-status" role="status"></p><div class="inspection-actions"><button type="button" id="inspection-feedback-retry">Retry feedback</button><button type="button" id="inspection-save-retry">Retry server save</button><button type="button" id="inspection-again">Practice this scenario again</button><button type="button" id="inspection-download">Download conversation</button><button type="button" id="inspection-continue" class="primary-action">Next: Final Exam</button></div></section>
    </div>
    <details class="inspection-history"><summary>Your saved doorstep practice</summary><div id="inspection-history"></div></details>
  </div>`;
  const storageKey=`roof-er.inspectionPractice.${localStorage.getItem('roof-er.userId') || 'local'}`;
  let localAvailable=true,disposed=false;let history:InspectionRecord[]=[];
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
    for(const record of history.filter(r=>r.scenario.id===INITIAL_PITCH_SCENARIO.id)){const item=document.createElement('button');item.type='button';item.textContent=`${new Date(record.startedAt).toLocaleString()} · ${record.completed?'Finished':'Interrupted'} · ${record.scenario.prompt}`;
      item.disabled=['connecting','practicing','scoring'].includes(flow.phase);
      item.onclick=()=>{flow.dispose();flow=makeFlow(record.scenario);flow.restore(record);};list.append(item);}
    if(!history.some(r=>r.scenario.id===INITIAL_PITCH_SCENARIO.id))list.textContent='Completed and interrupted conversations will appear here.';
  };
  let lastTranscript='',lastFeedback='';
  const update=()=>{
    if(disposed)return;persist();
    root.querySelector<HTMLElement>('.doorstep-practice')!.dataset.phase=flow.phase;
    const phase=flow.phase,active=['connecting','practicing','scoring'].includes(phase);
    root.querySelector('#inspection-state')!.textContent=flow.message || 'Ready when you are.';
    root.querySelector('#inspection-prompt')!.textContent=flow.scenario.prompt;
    root.querySelector('#inspection-points')!.innerHTML=flow.scenario.expectedKeyPoints.map(point=>`<li>${escapeText(point)}</li>`).join('');
    button('inspection-start').disabled=active;button('inspection-start').textContent=phase==='ready'?'Start voice practice':'Retry same scenario';
    button('inspection-check').disabled=active;button('inspection-speaker').disabled=active;
    button('inspection-check').textContent=checking?'Stop microphone check':'Check microphone';
    if(previousPhase!==phase){
      previousPhase=phase;clearTimeout(speechTimer);
      if(['connecting','practicing','completed'].includes(phase))requestAnimationFrame(()=>{
        if(disposed || flow.phase!==phase)return;
        const target=root.querySelector<HTMLElement>(phase==='completed'?'#inspection-debrief':'#inspection-state');
        target?.scrollIntoView({block:'start',behavior:'instant'});
      });
      if(phase==='practicing' && !flow.typing)speechTimer=setTimeout(()=>{
        if(flow.phase==='practicing' && !flow.typing && !flow.record?.transcript.some(t=>t.role==='user')){
          root.querySelector('#inspection-state')!.textContent='No words from you have been captured yet. Speak a short sentence. If nothing appears below, stop and check your microphone then retry voice practice.';
        }
      },15000);
    }
    button('inspection-review').disabled=phase==='scoring';
    const controls=root.querySelector<HTMLElement>('#inspection-live-controls')!;controls.hidden=!active && phase!=='interrupted';
    button('inspection-mute').hidden=flow.typing;button('inspection-mute').disabled=phase!=='practicing';button('inspection-mute').textContent=flow.muted?'Unmute microphone':'Mute microphone';button('inspection-mute').setAttribute('aria-pressed',String(flow.muted));
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
    feedback:async(record,signal)=>{const data=await inspectionRequest('/ai/inspection-feedback',{scenario:record.scenario,transcript:record.transcript},signal,60000);return normalizeInspectionFeedback(data.feedback,record.scenario,record.transcript);},
    save:async(record,signal)=>{const result=await inspectionRequest('/roleplay/inspection-save',record,signal);if(result.sessionId!==record.id)throw Error('Session save was not confirmed.');},
    changed:update,completed:()=>{complete();announceTrainingStatus('Initial pitch practice completed. Review your feedback below.');}
  });
  flow=makeFlow(INITIAL_PITCH_SCENARIO);update();
  button('inspection-start').onclick=()=>{stopCheck();void flow.start();};
  button('inspection-again').onclick=()=>{stopCheck();void flow.start();};
  button('inspection-continue').onclick=()=>{complete();document.getElementById('lesson-next')?.click();};
  button('inspection-check').onclick=async()=>{
    if(checking){stopCheck();audioStatus.textContent='Microphone check stopped. Start voice practice when ready.';update();return;}
    stopCheck();checking=true;update();const signal=audioController.signal;let detected=false;
    audioStatus.textContent='Allow microphone access, then say a sentence. The check stops after ten seconds.';
    try{
      await checkMicrophone(signal,level=>{if(disposed)return;root.querySelector<HTMLMeterElement>('#inspection-level')!.value=level;if(level>0.03)detected=true;});
      if(signal.aborted)return;
      audioTimer=setTimeout(()=>{stopCheck();audioStatus.textContent=detected?'Microphone detected sound. If you heard the test tone, you are ready for voice practice.':'No microphone sound detected. Check your selected microphone and mute switch, then retry voice practice.';update();},10000);
    }catch(error){if(signal.aborted)return;stopCheck();audioStatus.textContent=(error as Error).name==='NotAllowedError'?'Microphone permission was denied. Allow access in browser settings, then retry voice practice.':(error as Error).message;update();}
  };
  button('inspection-speaker').onclick=()=>{const signal=audioController.signal;void playSpeakerCheck(signal).then(()=>{if(!disposed&&!signal.aborted)audioStatus.textContent='A short tone was played. If you did not hear it, check your volume and selected audio output, then retry voice practice.';}).catch(()=>{if(!disposed)audioStatus.textContent='Sound could not play. Check your audio output then retry voice practice.';});};
  button('inspection-review').onclick=review;
  button('inspection-end').onclick=()=>void flow.finish();
  button('inspection-mute').onclick=()=>flow.toggleMute();
  button('inspection-cancel').onclick=()=>flow.stop();
  button('inspection-feedback-retry').onclick=()=>void flow.retryFeedback();
  button('inspection-save-retry').onclick=()=>void flow.retrySave();
  button('inspection-download').onclick=()=>{
    if(!flow.record)return;
    const blob=new Blob([JSON.stringify(flow.record,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='initial-pitch-practice-'+flow.record.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return ()=>{persist();disposed=true;stopCheck();clearTimeout(speechTimer);flow.dispose();};
}
