/** Bound permission prompts and release streams that arrive after cancellation. */
export function acquireMicrophone(signal:AbortSignal, timeout=20000):Promise<MediaStream> {
  if(signal.aborted)return Promise.reject(Error('Microphone check cancelled.'));
  if(!navigator.mediaDevices?.getUserMedia)return Promise.reject(Error('Microphone access is unavailable. Use a supported browser with microphone access.'));
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error?:Error,stream?:MediaStream)=>{
      if(settled){stream?.getTracks().forEach(track=>track.stop());return;}
      settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
      if(error)reject(error);else resolve(stream!);
    };
    const abort=()=>finish(Error('Microphone request cancelled.'));
    const timer=setTimeout(()=>finish(Error('Microphone permission timed out. Allow microphone access in your browser, then retry.')),timeout);
    signal.addEventListener('abort',abort,{once:true});
    navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false})
      .then(stream=>finish(undefined,stream),error=>finish(error));
  });
}

export async function checkMicrophone(signal:AbortSignal,onLevel:(level:number)=>void):Promise<()=>void> {
  const Audio=window.AudioContext || (window as any).webkitAudioContext;
  if(!Audio)throw Error('This browser cannot check audio. Try a supported browser.');
  const context=new Audio() as AudioContext;
  let stream:MediaStream|null=null,frame=0;
  const close=()=>{cancelAnimationFrame(frame);stream?.getTracks().forEach(t=>t.stop());void context.close().catch(()=>{});onLevel(0);signal.removeEventListener('abort',close);};
  signal.addEventListener('abort',close,{once:true});
  try{
    await context.resume();stream=await acquireMicrophone(signal);
    if(signal.aborted){close();throw Error('Microphone check cancelled.');}
    const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();
    analyser.fftSize=256;source.connect(analyser);
    const samples=new Float32Array(analyser.fftSize);
    const measure=()=>{analyser.getFloatTimeDomainData(samples);onLevel(Math.min(1,Math.sqrt(samples.reduce((sum,sample)=>sum+sample*sample,0)/samples.length)*8));frame=requestAnimationFrame(measure);};
    measure();return close;
  }catch(error){close();throw error;}
}

export async function playSpeakerCheck(signal:AbortSignal):Promise<void> {
  const Audio=window.AudioContext || (window as any).webkitAudioContext;
  if(!Audio)throw Error('This browser cannot play the test sound.');
  const context=new Audio() as AudioContext;
  const close=()=>void context.close().catch(()=>{});
  signal.addEventListener('abort',close,{once:true});
  try{
    await context.resume();if(signal.aborted)return;
    const tone=context.createOscillator(),gain=context.createGain();
    tone.frequency.value=440;gain.gain.value=0.08;tone.connect(gain);gain.connect(context.destination);
    tone.onended=()=>{signal.removeEventListener('abort',close);close();};
    tone.start();tone.stop(context.currentTime+0.4);
  }catch(error){signal.removeEventListener('abort',close);close();throw error;}
}
