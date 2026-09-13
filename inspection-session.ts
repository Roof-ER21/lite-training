import { appendInspectionTurn, type InspectionScenario, type InspectionTurn, type InspectionFeedback } from './server/lib/inspection-contract';
export type SessionPhase='ready'|'connecting'|'practicing'|'scoring'|'completed'|'interrupted';
export type InspectionRecord={id:string;scenario:InspectionScenario;difficulty:'BEGINNER';startedAt:string;transcript:InspectionTurn[];feedback:InspectionFeedback|null;completed:boolean};
export interface InspectionConnection {close:()=>void; mute:(muted:boolean)=>void; finish:()=>Promise<void>}
export interface InspectionDependencies {
  connect:(scenario:InspectionScenario,onMessage:(message:any)=>void,onDisconnect:()=>void,signal:AbortSignal)=>Promise<InspectionConnection>;
  feedback:(record:InspectionRecord,signal:AbortSignal)=>Promise<InspectionFeedback>;
  save:(record:InspectionRecord,signal:AbortSignal)=>Promise<void>;
  changed:()=>void;
  completed:()=>void;
}
export class InspectionSession {
  phase:SessionPhase='ready'; record:InspectionRecord|null=null; message=''; saved=false; saving=false; muted=false;
  private connection:InspectionConnection|null=null;
  private controller=new AbortController(); private generation=0; private completedOnce=false;
  constructor(public scenario:InspectionScenario,private deps:InspectionDependencies){}
  private emit(){this.deps.changed();}
  async start(){
    if(['connecting','practicing','scoring'].includes(this.phase))return;
    this.controller.abort();this.controller=new AbortController(); const generation=++this.generation;
    this.record={id:crypto.randomUUID(),scenario:this.scenario,difficulty:'BEGINNER',startedAt:new Date().toISOString(),transcript:[],feedback:null,completed:false};
    this.completedOnce=false;this.saved=false;this.saving=false;this.muted=false;this.phase='connecting';this.message='Connecting microphone and inspection practice…';this.emit();
    try {
      const connection=await this.deps.connect(this.scenario,m=>{if(generation===this.generation)this.receive(m);},()=>{if(generation===this.generation && ['connecting','practicing'].includes(this.phase))this.interrupt('Connection interrupted. Your captured transcript is still here. Review it or retry the same scenario.');},this.controller.signal);
      if(generation!==this.generation || this.phase!=='connecting'){connection.close();return;}
      this.connection=connection;this.phase='practicing';this.message='Ready. Explain the inspection to Agnes.';this.emit();
    } catch(error){if(generation===this.generation)this.interrupt((error as Error).message || 'Could not start practice.');}
  }
  receive(message:any){
    if(!this.record || !['connecting','practicing','scoring'].includes(this.phase))return;
    const content=message.serverContent;if(!content)return;
    for(const [role,key] of [['user','inputTranscription'],['agnes','outputTranscription']] as const){
      const text=content[key]?.text;if(typeof text!=='string' || !text.trim())continue;
      appendInspectionTurn(this.record.transcript,role,text);
    }
    this.emit();
  }
  toggleMute(){if(this.phase!=='practicing')return;this.muted=!this.muted;this.connection?.mute(this.muted);this.emit();}
  async finish(){
    if(!['practicing','interrupted'].includes(this.phase) || !this.record)return;
    this.phase='scoring';this.message='Finishing the transcript…';this.emit();
    const generation=this.generation;
    try{await this.connection?.finish();}catch{/* Retain all captured speech if transport already closed. */}
    this.connection?.close();this.connection=null;
    if(generation!==this.generation)return;
    if(!this.record.transcript.some(t=>t.role==='user'&&t.text.trim())){this.phase='interrupted';this.message='No rep speech was captured. Check microphone permission and retry; this has not completed the module.';this.emit();return;}
    this.record.completed=true;
    await this.scoreAndSave(generation);
  }
  async retryFeedback(){if(this.phase!=='completed' || !this.record || this.record.feedback || this.saving)return;this.phase='scoring';await this.scoreAndSave(this.generation);}
  private async scoreAndSave(generation:number){
    this.message='Preparing your inspection feedback…';this.emit();
    const record=this.record!;
    try{const feedback=await this.deps.feedback(record,this.controller.signal);if(generation!==this.generation)return;record.feedback=feedback;this.message='Review what you covered and choose a point to practice again.';}
    catch{if(generation!==this.generation)return;this.message='Practice finished, but AI feedback is unavailable. Your captured conversation is kept below. You can retry feedback without repeating the conversation.';}
    if(generation!==this.generation)return;
    this.phase='completed';
    // Preserve the existing completion policy for a finished practice with no score.
    if(!this.completedOnce){this.completedOnce=true;this.deps.completed();}
    this.emit();await this.retrySave();
  }
  async retrySave(){
    if(!this.record || !this.record.completed || this.phase!=='completed' || this.saving)return;
    const generation=this.generation;
    this.saving=true;this.emit();
    try{await this.deps.save(this.record,this.controller.signal);if(generation===this.generation)this.saved=true;}
    catch{if(generation===this.generation)this.saved=false;}
    if(generation===this.generation){this.saving=false;this.emit();}
  }
  restore(record:InspectionRecord){this.record=record;this.scenario=record.scenario;this.phase=record.completed?'completed':'interrupted';this.completedOnce=record.completed;this.message='Opened a conversation saved on this device.';this.emit();}
  stop(){this.dispose();this.controller=new AbortController();this.phase='interrupted';this.message='Practice stopped. Your captured transcript remains available; review it or retry the same scenario.';this.emit();}
  private interrupt(message:string){this.phase='interrupted';this.message=message;this.connection?.close();this.connection=null;this.emit();}
  dispose(){++this.generation;this.controller.abort();this.connection?.close();this.connection=null;}
}
