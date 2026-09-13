import { GoogleGenAI } from '@google/genai';
import { inspectionInstruction, type InspectionScenario } from './server/lib/inspection-contract';
import type { InspectionConnection } from './inspection-session';

export async function inspectionRequest(path:string,body:unknown,signal:AbortSignal,timeout=25000):Promise<any>{
  const response=await fetch('/api'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('roof-er.sessionToken') || ''}`},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)])});
  const data=await response.json();if(!response.ok || data.success===false)throw Error(data.message || data.error || 'Request failed.');return data;
}
export async function connectInspection(scenario:InspectionScenario,onMessage:(message:any)=>void,onDisconnect:()=>void,signal:AbortSignal):Promise<InspectionConnection>{
  let stream:MediaStream|null=null;let session:any=null;let node:AudioWorkletNode|null=null;let closed=false;let muted=false;let sending=false;
  let next=0;const sources=new Set<AudioBufferSourceNode>();
  const Audio=window.AudioContext || (window as any).webkitAudioContext;
  if(!navigator.mediaDevices?.getUserMedia || !Audio)throw Error('This browser cannot start microphone practice. Use a current browser with microphone access.');
  const input=new Audio({sampleRate:16000}) as AudioContext;
  const output=new Audio({sampleRate:24000}) as AudioContext;
  const stopAudio=()=>{for(const source of sources){try{source.stop();}catch{}}sources.clear();next=0;};
  const close=()=>{
    if(closed)return;closed=true;sending=false;
    node?.disconnect();stream?.getTracks().forEach(t=>t.stop());stopAudio();
    try{session?.close();}catch{}
    void input.close().catch(()=>{});void output.close().catch(()=>{});
    signal.removeEventListener('abort',abort);
  };
  let readyResolve:()=>void=()=>{},readyReject:(error:Error)=>void=()=>{};
  const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  // Attach a rejection handler immediately while token/media setup is in flight.
  void ready.catch(()=>{});
  const abort=()=>{readyReject(Error('Practice cancelled.'));close();};
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)abort();
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{
    await Promise.all([input.resume(),output.resume()]);
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
    if(closed || signal.aborted){stream.getTracks().forEach(t=>t.stop());throw Error('Practice cancelled.');}
    const token=await inspectionRequest('/ai/gemini-token',{systemInstruction:inspectionInstruction(scenario),inspection:true},signal);
    if(!token.token || !token.model)throw Error('Voice practice could not obtain a connection. Retry when online.');
    const ai=new GoogleGenAI({apiKey:token.token,httpOptions:{apiVersion:'v1alpha'}});
    timeout=setTimeout(()=>readyReject(Error('Voice connection timed out. Retry when your connection is stable.')),20000);
    const connecting=ai.live.connect({model:token.model,callbacks:{
      onopen:()=>{},
      onmessage:(message:any)=>{
        if(closed)return;
        if(message.setupComplete)readyResolve();
        if(message.serverContent?.interrupted)stopAudio();
        onMessage(message);
        for(const part of message.serverContent?.modelTurn?.parts || []){
          if(!part.inlineData?.data)continue;
          try{
            const bytes=Uint8Array.from(atob(part.inlineData.data),(c:string)=>c.charCodeAt(0));
            const pcm=new Int16Array(bytes.buffer,0,Math.floor(bytes.byteLength/2));
            const rate=Number(part.inlineData.mimeType?.match(/rate=(\d+)/)?.[1] || 24000);
            const buffer=output.createBuffer(1,pcm.length,rate);const channel=buffer.getChannelData(0);
            for(let i=0;i<pcm.length;i++)channel[i]=pcm[i]/32768;
            const source=output.createBufferSource();source.buffer=buffer;source.connect(output.destination);
            next=Math.max(output.currentTime,next);source.start(next);next+=buffer.duration;
            sources.add(source);source.onended=()=>sources.delete(source);
          }catch{/* A malformed audio part must not discard the transcript. */}
        }
      },
      onclose:()=>{readyReject(Error('Voice connection closed before it was ready.'));if(!closed){close();onDisconnect();}},
      onerror:()=>{readyReject(Error('Voice connection failed. Your microphone has been released; retry when online.'));if(!closed){close();onDisconnect();}}
    }});
    void connecting.then(value=>{if(closed)value.close();},()=>{});
    const connected=await Promise.race([connecting,ready.then(()=>connecting)]);
    session=connected;
    if(closed || signal.aborted){session.close();throw Error('Practice cancelled.');}
    await ready;clearTimeout(timeout);
    await input.audioWorklet.addModule('/inspection-audio-worklet.js');
    if(closed || signal.aborted)throw Error('Practice cancelled.');
    node=new AudioWorkletNode(input,'inspection-capture');
    const mic=input.createMediaStreamSource(stream);mic.connect(node);node.connect(input.destination);
    let buffered:number[]=[];
    const flush=()=>{
      if(!buffered.length || closed)return;
      const ratio=input.sampleRate/16000;const pcm=new Int16Array(Math.floor(buffered.length/ratio));
      for(let i=0;i<pcm.length;i++)pcm[i]=Math.max(-1,Math.min(1,buffered[Math.floor(i*ratio)]))*32767;
      buffered=[];
      let binary='';for(const byte of new Uint8Array(pcm.buffer))binary+=String.fromCharCode(byte);
      try{session.sendRealtimeInput({audio:{data:btoa(binary),mimeType:'audio/pcm;rate=16000'}});}catch{close();onDisconnect();}
    };
    node.port.onmessage=event=>{
      if(closed || muted || !sending)return;
      buffered.push(...event.data);
      if(buffered.length>=2048)flush();
    };
    sending=true;
    session.sendClientContent({turns:[{role:'user',parts:[{text:'Begin the supplied rookie inspection scenario with its exact opening question.'}]}],turnComplete:true});
    return {close,mute(value){muted=value;buffered=[];stream?.getAudioTracks().forEach(t=>t.enabled=!value);},async finish(){
      flush();sending=false;stream?.getAudioTracks().forEach(t=>t.enabled=false);stopAudio();
      if(!closed)session.sendRealtimeInput({audioStreamEnd:true});
      // Allow final transcription events to arrive before snapshotting the debrief.
      await new Promise(resolve=>setTimeout(resolve,1200));
    }};
  }catch(error){clearTimeout(timeout);close();
    const name=(error as Error).name;
    if(name==='NotAllowedError')throw Error('Microphone access was denied. Enable it in browser settings, then retry.');
    if(name==='NotFoundError')throw Error('No microphone was found. Connect one and retry.');
    if(name==='NotReadableError')throw Error('The microphone is busy. Close the other recording app and retry.');
    throw error;
  }
}
