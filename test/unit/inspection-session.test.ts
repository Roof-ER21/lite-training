import { describe,it,expect,vi } from 'vitest';
import { InspectionSession } from '../../inspection-session';
import { INITIAL_PITCH_SCENARIO,inspectionInstruction,normalizeInspectionFeedback,appendInspectionTurn } from '../../server/lib/inspection-contract';
const scenario={id:'insp-test',prompt:'What happens during the inspection?',expectedKeyPoints:['Photo documentation'],followUps:['Can I see the photos?']};
const transcript=[{role:'user' as const,text:'I will take a close-up and an overview.'}];
const feedback=normalizeInspectionFeedback({summary:'Clear explanation.',criteria:[{status:'covered',evidence:'a close-up and an overview',nextStep:'Explain why both help.'}]},scenario,transcript);
function harness(overrides:any={}){
  const close=vi.fn(),mute=vi.fn(),completed=vi.fn(),save=vi.fn().mockResolvedValue(undefined);
  let message:(value:any)=>void=()=>{},disconnect=()=>{};
  const deps={connect:vi.fn(async(_s:any,onMessage:any,onDisconnect:any)=>{message=onMessage;disconnect=onDisconnect;return{close,mute,finish:vi.fn().mockResolvedValue(undefined)};}),feedback:vi.fn().mockResolvedValue(feedback),save,changed:vi.fn(),completed,...overrides};
  const flow=new InspectionSession(scenario,deps);
  return {flow,deps,close,mute,completed,save,speech:()=>message({serverContent:{inputTranscription:{text:transcript[0].text},outputTranscription:{text:'Thank you.'}}}),disconnect:()=>disconnect()};
}
describe('rookie inspection session',()=>{
  it('typed practice retains a failed reply and retries without duplicating the rep turn',async()=>{
    const reply=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue('Can I see the photos?');
    const h=harness({reply});
    h.flow.startText();
    await h.flow.sendText('I will take a close-up and an overview.');
    expect(h.flow.record?.transcript.filter(t=>t.role==='user')).toHaveLength(1);
    expect(h.flow.replyFailed).toBe(true);
    await h.flow.retryReply();
    expect(h.flow.replyFailed).toBe(false);
    expect(h.flow.record?.transcript.filter(t=>t.role==='user')).toHaveLength(1);
    await h.flow.finish();
    expect(h.completed).toHaveBeenCalledOnce();
    expect(h.flow.record?.inputMode).toBe('text');
  });
  it('switching from interrupted voice to typing preserves captured speech',async()=>{
    const h=harness({reply:vi.fn().mockResolvedValue('Thank you.')});
    await h.flow.start();h.speech();h.disconnect();const id=h.flow.record!.id;
    h.flow.startText();
    expect(h.flow.record?.id).toBe(id);
    expect(h.flow.record?.inputMode).toBe('mixed');
    expect(h.flow.record?.transcript.some(t=>t.text===transcript[0].text)).toBe(true);
  });
  it('ignores a late typed reply after stopping and starting another attempt',async()=>{
    let resolve:any;const h=harness({reply:()=>new Promise(r=>resolve=r)});
    h.flow.startText();const pending=h.flow.sendText('Old reply');h.flow.stop();h.flow.startText();
    resolve('Late homeowner response');await pending;
    expect(h.flow.record?.transcript.some(t=>t.text==='Late homeowner response')).toBe(false);
  });
  it('can review captured typed words after stopping a pending reply',async()=>{
    const h=harness({reply:()=>new Promise(()=>{})});h.flow.startText();void h.flow.sendText('I document photos.');
    h.flow.stop();await h.flow.finish();expect(h.completed).toHaveBeenCalledOnce();
  });
  it('joins streamed word fragments without breaking the transcript',()=>{const turns:any[]=[];appendInspectionTurn(turns,'user','I document col');appendInspectionTurn(turns,'user','lateral damage.');appendInspectionTurn(turns,'agnes','Thank you.');expect(turns).toEqual([{role:'user',text:'I document collateral damage.'},{role:'agnes',text:'Thank you.'}]);});
  it('uses the exact scenario and locks instructions to rookie inspection',()=>{const prompt=inspectionInstruction(scenario);expect(prompt).toContain(scenario.prompt);expect(prompt).toContain('ROOKIE / EASY');expect(prompt).toContain('Do not escalate difficulty');});
  it('captures both speakers and completes/saves once despite repeated End',async()=>{const h=harness();await h.flow.start();h.speech();await Promise.all([h.flow.finish(),h.flow.finish()]);expect(h.flow.record?.transcript.map(t=>t.role)).toEqual(['user','agnes']);expect(h.completed).toHaveBeenCalledTimes(1);expect(h.save).toHaveBeenCalledTimes(1);expect(h.flow.saved).toBe(true);expect(h.close).toHaveBeenCalledTimes(1);});
  it('does not complete on denied microphone or empty speech',async()=>{const h=harness({connect:vi.fn().mockRejectedValue(Error('Microphone denied'))});await h.flow.start();expect(h.flow.phase).toBe('interrupted');await h.flow.finish();expect(h.completed).not.toHaveBeenCalled();expect(h.save).not.toHaveBeenCalled();});
  it('keeps interrupted speech available for review and closes the transport',async()=>{const h=harness();await h.flow.start();h.speech();h.disconnect();expect(h.flow.phase).toBe('interrupted');expect(h.flow.record?.transcript.length).toBe(2);expect(h.close).toHaveBeenCalled();await h.flow.finish();expect(h.flow.phase).toBe('completed');});
  it('discloses unavailable feedback and retries without repeating completion',async()=>{const h=harness({feedback:vi.fn().mockRejectedValueOnce(Error('timeout')).mockResolvedValue(feedback)});await h.flow.start();h.speech();await h.flow.finish();expect(h.flow.record?.feedback).toBeNull();expect(h.flow.message).toContain('unavailable');await h.flow.retryFeedback();expect(h.flow.record?.feedback?.score).toBe(100);expect(h.completed).toHaveBeenCalledTimes(1);expect(h.save).toHaveBeenCalledTimes(2);});
  it('retains the same record id after failed save',async()=>{const h=harness({save:vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(undefined)});await h.flow.start();h.speech();await h.flow.finish();expect(h.flow.saved).toBe(false);const id=h.flow.record!.id;await h.flow.retrySave();expect(h.flow.saved).toBe(true);expect(h.flow.record!.id).toBe(id);});
  it('releases a late connection after navigation without completing',async()=>{let resolve:any;const close=vi.fn();const h=harness({connect:()=>new Promise(r=>resolve=r)});const pending=h.flow.start();h.flow.dispose();resolve({close,mute:vi.fn(),finish:vi.fn()});await pending;expect(close).toHaveBeenCalledOnce();expect(h.completed).not.toHaveBeenCalled();});
  it('does not let late feedback overwrite a newer scenario attempt',async()=>{let resolve:any;const h=harness({feedback:()=>new Promise(r=>resolve=r)});await h.flow.start();h.speech();const pending=h.flow.finish();await Promise.resolve();h.flow.stop();await h.flow.start();resolve(feedback);await pending;expect(h.flow.record?.feedback).toBeNull();expect(h.completed).not.toHaveBeenCalled();});
  it('rejects unsupported quotes and derives the score from coverage',()=>{expect(()=>normalizeInspectionFeedback({summary:'Good',criteria:[{status:'covered',evidence:'invented words',nextStep:'Practice'}]},scenario,transcript)).toThrow('Unsupported');expect(normalizeInspectionFeedback({summary:'Try again',criteria:[{status:'partial',evidence:'close-up',nextStep:'Add the context'}]},scenario,transcript).score).toBe(50);});
});

it('Module 13 is one initial door-knock pitch with script and rookie objection checkpoints',()=>{
 const prompt=inspectionInstruction(INITIAL_PITCH_SCENARIO);
 expect(INITIAL_PITCH_SCENARIO.prompt).toBe('Hi, can I help you?');
 expect(INITIAL_PITCH_SCENARIO.expectedKeyPoints).toHaveLength(6);
 expect(prompt).toContain('INITIAL DOOR-KNOCK PITCH');
 expect(prompt).toContain('raise ONE mild objection before agreeing');
 expect(prompt).toContain('Wait for the rep to answer it');
 expect(prompt).toContain('Do not keep inventing objections after agreement');
 expect(prompt).not.toContain('INSPECTION PROCESS training');
});
