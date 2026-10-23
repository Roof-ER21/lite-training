export type InspectionScenario = {id:string; prompt:string; expectedKeyPoints:string[]; followUps?:string[]};
// Module 13 has exactly one exercise. The legacy insp prefix keeps saved records compatible.
export const INITIAL_PITCH_SCENARIO: InspectionScenario = {
  id: 'insp-doorstep-initial-pitch',
  prompt: 'Hi, can I help you?',
  expectedKeyPoints: [
    'Introduce yourself by name and greet the homeowner.',
    'Introduce Roof-ER as a local roofing company and explain how we help homeowners.',
    'Connect your visit to storms in the area and nearby work, using only details you can support.',
    'Offer the free inspection, explain that you will take photos and share what you find.',
    'Respond to a simple homeowner objection with acknowledgment and a relevant, low-pressure answer.',
    'Move straight into the inspection without asking permission: say it takes 10–15 minutes, you will walk the perimeter, then grab your ladder and check the roof.'
  ],
  followUps: ['I’m a little busy right now.', 'My roof looks fine from the ground.', 'Is there a charge for the inspection?', 'How long would it take?']
};
export type InspectionTurn = {role:'user'|'agnes'; text:string};
export function validInspectionConversation(scenario:any,transcript:any):boolean {
  return !!scenario && typeof scenario.id==='string' && scenario.id.startsWith('insp-') &&
    typeof scenario.prompt==='string' && scenario.prompt.length>0 && scenario.prompt.length<=2000 &&
    Array.isArray(scenario.expectedKeyPoints) && scenario.expectedKeyPoints.length>0 && scenario.expectedKeyPoints.length<=10 &&
    scenario.expectedKeyPoints.every((p:any)=>typeof p==='string' && p.length>0 && p.length<=1000) &&
    (scenario.followUps===undefined || (Array.isArray(scenario.followUps) && scenario.followUps.length<=20 && scenario.followUps.every((p:any)=>typeof p==='string' && p.length<=2000))) &&
    Array.isArray(transcript) && transcript.length>0 && transcript.length<=100 &&
    transcript.every((t:any)=>t && ['user','agnes'].includes(t.role) && typeof t.text==='string' && t.text.trim().length>0 && t.text.length<=4000) &&
    transcript[transcript.length-1].role==='user' && JSON.stringify(transcript).length<=60000;
}
export type InspectionFeedback = {score:number; summary:string; criteria:{point:string; status:'covered'|'partial'|'missed'; evidence:string; nextStep:string}[]};
export function inspectionInstruction(scenario:InspectionScenario):string {
  if (scenario.id === INITIAL_PITCH_SCENARIO.id) return `You are Agnes, a homeowner who has just opened the front door after a Roof-ER representative knocked.
This is the INITIAL DOOR-KNOCK PITCH exercise. Difficulty stays ROOKIE / EASY.
Open with exactly: "Hi, can I help you?" Then let the rep deliver the initial script without interrupting.
Stay in character as a friendly, mildly curious homeowner. Use short natural replies, one simple question at a time, only after the rep pauses.
The only goal is that the rep starts the free inspection. Do not escalate difficulty or introduce new scenarios.
Do not shift into conducting the inspection, roof findings, post-inspection presentations, claims, financing, or sales closing.
After the rep delivers the opening pitch, raise ONE mild objection before agreeing: "I’m a little busy right now" or "My roof looks fine from the ground."
Wait for the rep to answer it. Do not answer the objection for them. Acknowledge a relevant, respectful response and ask one brief clarification, such as whether the inspection is free or how long it takes.
Keep a genuine back-and-forth: never deliver a list of objections in one turn. If the rep ignores your concern, gently repeat or clarify the same concern rather than escalating.
Once the rep addresses the concern, explains the free inspection and tells you the next step (about 10–15 minutes, the perimeter, then the ladder and the roof), agree naturally and let the rep finish their handoff. The rep is taught NOT to ask permission; never prompt them to ask, and never ask "aren't you going to ask me first?" A reasonable appointment offer also resolves a time objection.
If the rep gets stuck, give a gentle homeowner prompt, not a model sales answer. This is practice, not an adversarial test.
Do not keep inventing objections after agreement. Do not recite the rep's script for them or give grades during the conversation.
Do not invent storm dates, neighbor names, damage, credentials, or insurance guarantees. Ask for clarification if needed.
Preparation and feedback points: ${JSON.stringify(INITIAL_PITCH_SCENARIO.expectedKeyPoints)}
Pronounce Roof-ER as Roof, E, R. Feedback comes separately after the rep ends practice.`;
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
    if(!row || !['covered','partial','missed'].includes(row.status) || typeof row.nextStep!=='string')throw Error('Invalid feedback');
    // New provider responses cite an existing rep turn, not a generated quotation.
    // Saved/legacy feedback still uses the exact-quote validation below.
    let evidence=typeof row.evidence==='string'?row.evidence.trim():'';
    if(row.status!=='missed' && row.evidenceTurnIndex!==undefined) {
      const turn=Number.isInteger(row.evidenceTurnIndex)?transcript[row.evidenceTurnIndex]:undefined;
      if(!turn || turn.role!=='user' || !turn.text.trim()) throw Error('Unsupported feedback evidence');
      evidence=turn.text.trim();
    }
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
