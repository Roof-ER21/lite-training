import {afterEach,it,expect,vi} from 'vitest';
import {acquireMicrophone} from '../../inspection-audio-check';
import {validInspectionConversation} from '../../server/lib/inspection-contract';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('releases a microphone granted after the user cancelled',async()=>{
  let resolve:any;const stop=vi.fn();
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}});
  const controller=new AbortController();const pending=acquireMicrophone(controller.signal);
  controller.abort();await expect(pending).rejects.toThrow('cancelled');
  resolve({getTracks:()=>[{stop}]});await Promise.resolve();expect(stop).toHaveBeenCalledOnce();
});
it('times out an unanswered permission prompt and releases a late grant',async()=>{
  vi.useFakeTimers();let resolve:any;const stop=vi.fn();
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}});
  const pending=acquireMicrophone(new AbortController().signal,100);
  const rejected=expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(101);await rejected;
  resolve({getTracks:()=>[{stop}]});await Promise.resolve();expect(stop).toHaveBeenCalledOnce();
});
it('bounds typed conversation input and rejects malformed turns before provider calls',()=>{
  const scenario={id:'insp-test',prompt:'What happens?',expectedKeyPoints:['Photos']};
  expect(validInspectionConversation(scenario,[{role:'user',text:'Explain photos'}])).toBe(true);
  expect(validInspectionConversation(scenario,[null])).toBe(false);
  expect(validInspectionConversation(scenario,[{role:'user',text:'x'.repeat(4001)}])).toBe(false);
  expect(validInspectionConversation({...scenario,followUps:'invalid'},[{role:'user',text:'Hello'}])).toBe(false);
});
