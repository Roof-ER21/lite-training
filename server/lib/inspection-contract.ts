export type InspectionScenario = {id:string; prompt:string; expectedKeyPoints:string[]; followUps?:string[]};
export type InspectionTurn = {role:'user'|'agnes'; text:string};
export type InspectionFeedback = {score:number; summary:string; criteria:{point:string; status:'covered'|'partial'|'missed'; evidence:string; nextStep:string}[]};
export function inspectionInstruction(scenario:InspectionScenario):string {
  return `You are Agnes, a patient homeowner in Roof-ER's INSPECTION PROCESS training.
Difficulty is ROOKIE / EASY for the entire session. Speak slowly and naturally, ask one
simple question at a time, allow pauses, and give a gentle hint if the rep gets stuck.
Do not escalate difficulty, slam a door, fail the rep, or switch to a door-knocking,
sales-closing, or insurance-objection simulation. Do not give numerical grades.
The rep is learning to explain an inspection. Do not invent coverage, guarantees,
credentials, damage findings, or safety procedures. If a fact is unknown, ask the rep
to explain what they would verify. Use only the supplied scenario as training context.
Open with this exact homeowner question: ${JSON.stringify(scenario.prompt)}
Then use a relevant follow-up, one at a time: ${JSON.stringify(scenario.followUps || [])}
The rep's preparation points are: ${JSON.stringify(scenario.expectedKeyPoints)}
Stay with this scenario. Respond to what the rep actually says. End when instructed.
Pronounce Roof-ER as Roof, E, R. Feedback is provided separately after the conversation.`;
}
export function normalizeInspectionFeedback(value:any,scenario:InspectionScenario,transcript:InspectionTurn[]):InspectionFeedback {
  if(!value || typeof value.summary!=='string' || !Array.isArray(value.criteria) || value.criteria.length!==scenario.expectedKeyPoints.length) throw Error('Incomplete feedback');
  const speech=transcript.filter(t=>t.role==='user').map(t=>t.text).join(' ').toLowerCase().replace(/\s+/g,' ');
  const criteria=scenario.expectedKeyPoints.map((point,i)=>{
    const row=value.criteria[i];
    if(!row || !['covered','partial','missed'].includes(row.status) || typeof row.evidence!=='string' || typeof row.nextStep!=='string')throw Error('Invalid feedback');
    const evidence=row.evidence.trim();
    // A supported assessment must cite words that actually came from the rep.
    if(row.status!=='missed' && (!evidence || !speech.includes(evidence.toLowerCase().replace(/\s+/g,' '))))throw Error('Unsupported feedback evidence');
    return {point,status:row.status,evidence:row.status==='missed'?'':evidence,nextStep:row.nextStep.slice(0,1000)};
  });
  const score=Math.round(criteria.reduce((sum,row)=>sum+(row.status==='covered'?1:row.status==='partial'?0.5:0),0)/criteria.length*100);
  return {score,summary:value.summary.slice(0,1500),criteria};
}

/** Streaming transcription text includes its own word spacing. */
export function appendInspectionTurn(transcript:InspectionTurn[],role:InspectionTurn['role'],text:string):void {
  const last=transcript[transcript.length-1];
  if(last?.role===role)last.text+=text;
  else transcript.push({role,text});
}
