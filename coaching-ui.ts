import { escapeText } from './learning-workspace';
async function request(path:string,body?:unknown) {
  const response = await fetch('/api/coaching'+path,{method:body ? 'POST' : 'GET',headers:{Authorization:`Bearer ${localStorage.getItem('roof-er.sessionToken') || ''}`,'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})});
  if (!response.ok) throw Error((await response.json()).error || 'Could not connect to coaching.');
  return response.json();
}
export async function mountCoaching(root:HTMLElement, options:{userId?:string; modules:string[]; title:(id:string)=>string; navigate:(id:string)=>void; unlocked:()=>string[]}) {
  const manager = !!options.userId;
  const panel = document.createElement('section'); panel.className='coaching-panel';
  panel.innerHTML=`<h2>${manager ? 'Coaching & practice' : 'From your coach'}</h2><p role="status">Loading coaching…</p>`;
  root.append(panel);
  try {
    const data = await request(manager ? `/users/${options.userId}` : '/mine');
    if (!panel.isConnected) return;
    panel.querySelector('p')!.textContent = manager ? 'Use rep self-reviews to guide a conversation. These are not graded assessments.' : 'Review your assigned lesson, then mark the coaching note reviewed. Your exam record stays separate.';
    if (manager) {
      const needs = data.practice.filter((p:any)=>p.status==='needs_practice');
      const list = document.createElement('div');
      list.innerHTML=needs.length ? `<h3>Rep requested more practice</h3><ul>${needs.map((p:any)=>`<li>${escapeText(options.title(p.module_name))}: ${escapeText(p.section_title)}</li>`).join('')}</ul>` : '<p>No topics currently marked for more practice.</p>';
      panel.append(list);
      const form = document.createElement('form');
      form.innerHTML=`<label>Assign a lesson<select name="module" aria-label="Assign a lesson">${options.modules.filter(id=>!['final-exam','commitment'].includes(id)).map(id=>`<option value="${id}">${escapeText(options.title(id))}</option>`).join('')}</select></label><label>Coaching note shared with the rep<textarea name="note" required maxlength="3000" rows="3" placeholder="Describe what to practice and what you will review together."></textarea></label><button type="submit">Assign practice</button><p role="status"></p>`;
      form.onsubmit=async event=>{
        event.preventDefault(); const button=form.querySelector('button')!; button.disabled=true;
        const fields=new FormData(form); const message=form.querySelector('p')!;
        try {
          await request('/assignments',{userId:options.userId,module:fields.get('module'),note:fields.get('note')});
          message.textContent='Practice assigned. The rep can see your note on their training page.';
          (form.elements.namedItem('note') as HTMLTextAreaElement).value='';
          const fresh=await request(`/users/${options.userId}`); renderAssignments(fresh.assignments);
        } catch(error) {message.textContent=(error as Error).message;}
        finally {button.disabled=false;}
      };
      panel.append(form);
    }
    const records=document.createElement('div'); panel.append(records);
    function renderAssignments(assignments:any[]) {
      records.replaceChildren();
      if (!assignments.length) {records.innerHTML='<p>No coaching assignments yet.</p>';return;}
      assignments.forEach(a=>{
        const article=document.createElement('article'); article.className='coaching-record';
        article.innerHTML=`<h3>${escapeText(options.title(a.module_name))}</h3><p>${escapeText(a.note)}</p><p>${a.status==='reviewed' ? 'Reviewed by rep' : 'Assigned'}${a.manager_name ? ' · '+escapeText(a.manager_name) : ''}</p>`;
        if (!manager && a.status!=='reviewed') {
          const open=document.createElement('button'); open.textContent='Open assigned lesson';open.disabled=!options.unlocked().includes(a.module_name);
          open.onclick=()=>options.navigate(a.module_name); article.append(open);
          if(open.disabled)article.insertAdjacentHTML('beforeend','<p>Complete the preceding lessons to open this lesson. Your coach can use the existing unlock controls if needed.</p>');
          const done=document.createElement('button');done.textContent='Mark reviewed';
          done.onclick=async()=>{done.disabled=true;try{await request(`/assignments/${a.id}/review`,{});done.textContent='Reviewed';}catch(error){done.disabled=false; const message=document.createElement('p');message.setAttribute('role','status');message.textContent=(error as Error).message;article.append(message);}};
          article.append(done);
        }
        records.append(article);
      });
    }
    renderAssignments(data.assignments);
  } catch {
    panel.querySelector('p')!.textContent='Coaching is unavailable offline. Reconnect and reopen this page to load shared notes.';
  }
}
