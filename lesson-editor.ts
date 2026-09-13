import { escapeText } from './learning-workspace';
type Api = <T=any>(path:string, options?:RequestInit)=>Promise<T|null>;
type Content = {version:number;status:string;htmlContent:string};
type ModuleData = {module:{title:string};content:Content|null;versions:{version:number;status:string}[]};

/** Edit prose in place, preserving lesson IDs, media, and exercise markup. */
export async function mountLessonEditor(root:HTMLElement,moduleId:string,api:Api,back:()=>void,version?:number) {
  const data=await api<ModuleData>(`/cms/modules/${moduleId}${version ? '?version='+version : ''}`);
  if (!data) {root.innerHTML='<p role="alert">Lesson could not load. Return to Modules and retry.</p>';return;}
  const doc=new DOMParser().parseFromString(data.content?.htmlContent || '<div class="content-card"><h1>New lesson</h1></div>','text/html');
  let dirty=false;
  root.innerHTML=`<div class="structured-editor"><div><button type="button" id="editor-back">Back to modules</button><h1>Edit ${escapeText(data.module.title)}</h1><p>Edit lesson text, add learning guidance, and preview before publishing. Existing media and exercises stay in place.</p></div><label>Content version<select id="editor-version" aria-label="Content version">${data.versions.map(v=>`<option value="${v.version}" ${v.version===data.content?.version?'selected':''}>Version ${v.version} · ${v.status}</option>`).join('')}</select></label><div class="reference-actions"><button type="button" id="editor-save">Save draft</button><button type="button" id="editor-publish" ${data.content?.status==='draft'?'':'disabled'}>Publish saved draft</button></div><p id="editor-status" role="status">${data.content ? `Viewing version ${data.content.version} (${data.content.status}).` : 'No content yet.'}</p><details open><summary>Lesson text</summary><div id="editor-fields"></div></details><fieldset><legend>Learning guidance</legend><p>One objective or checklist item per line. Use approved lesson wording.</p><label>Learning objectives<textarea data-guide-field="objectives"></textarea></label><label>Worked example<textarea data-guide-field="example"></textarea></label><label>Practice prompt<textarea data-guide-field="practice"></textarea></label><label>Field checklist<textarea data-guide-field="checklist"></textarea></label></fieldset><h2>Preview</h2><iframe title="Lesson preview" sandbox=""></iframe></div>`;
  const status=root.querySelector<HTMLElement>('#editor-status')!;
  const publish=root.querySelector<HTMLButtonElement>('#editor-publish')!;
  const save=root.querySelector<HTMLButtonElement>('#editor-save')!;
  const frame=root.querySelector<HTMLIFrameElement>('iframe')!;
  const fields=root.querySelector<HTMLElement>('#editor-fields')!;
  const preview=()=>{
    frame.srcdoc=`<!doctype html><html data-theme="${document.documentElement.dataset.theme || 'light'}"><head>${[...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(link=>`<link rel="stylesheet" href="${link.href}">`).join('')}<style>body{font-family:Arial,sans-serif;background:var(--light-bg);color:var(--text-primary);padding:24px;line-height:1.6}img,video{max-width:100%}button,input,textarea{pointer-events:none}h1,h2,h3{line-height:1.2}</style></head><body>${doc.body.innerHTML}</body></html>`;
  };
  const changed=()=>{dirty=true;publish.disabled=true;status.textContent='Unsaved changes. Save a draft before publishing.';preview();};
  const nodes=[...doc.querySelectorAll<HTMLElement>('h1,h2,h3,h4,p,li')].filter(el=>!el.closest('[data-authored-guidance],script,style,[onclick],.quiz-options,.game-board,.module-completion-section') && !el.querySelector('button,input,textarea,select,img,video,ul,ol,p,h2,h3') && !!el.textContent?.trim());
  nodes.forEach((el,i)=>{
    const label=document.createElement('label');label.textContent=`${/^H/.test(el.tagName)?'Heading':'Text'} ${i+1}`;
    const textarea=document.createElement('textarea');textarea.value=el.textContent || '';textarea.rows=/^H/.test(el.tagName)?1:3;
    textarea.oninput=()=>{el.textContent=textarea.value;changed();};label.append(textarea);fields.append(label);
  });
  let guidance=doc.querySelector<HTMLElement>('[data-authored-guidance]');
  const labels:Record<string,string>={objectives:'What you’ll learn',example:'Worked example',practice:'Practice prompt',checklist:'Field checklist'};
  const values:Record<string,string>={};
  root.querySelectorAll<HTMLTextAreaElement>('[data-guide-field]').forEach(field=>{
    const name=field.dataset.guideField!;
    const existing=guidance?.querySelector(`[data-guidance="${name}"]`);
    field.value=existing ? [...existing.querySelectorAll('p,li')].map(el=>el.textContent).join('\n') : '';
    values[name]=field.value;
    field.oninput=()=>{
      values[name]=field.value;
      if(!guidance){guidance=doc.createElement('section');guidance.dataset.authoredGuidance='true';doc.querySelector('h1')?.after(guidance);if(!guidance.isConnected)doc.body.prepend(guidance);}
      guidance.innerHTML=Object.entries(values).filter(([,value])=>value.trim()).map(([name,value])=>`<section data-guidance="${name}"><h2>${labels[name]}</h2>${['objectives','checklist'].includes(name)?'<ul>'+value.split('\n').filter(Boolean).map(line=>`<li>${escapeText(line)}</li>`).join('')+'</ul>':`<p>${escapeText(value).replace(/\n/g,'<br>')}</p>`}</section>`).join('');
      changed();
    };
  });
  const confirmLeave=()=>!dirty || confirm('Discard unsaved lesson changes?');
  root.querySelector<HTMLButtonElement>('#editor-back')!.onclick=()=>{if(confirmLeave())back();};
  root.querySelector<HTMLSelectElement>('#editor-version')!.onchange=event=>{
    if(confirmLeave())void mountLessonEditor(root,moduleId,api,back,Number((event.target as HTMLSelectElement).value));
    else (event.target as HTMLSelectElement).value=String(data.content?.version || '');
  };
  save.onclick=async()=>{
    save.disabled=true;publish.disabled=true;status.textContent='Saving draft…';
    const isDraft=data.content?.status==='draft';
    const result=await api<{success:boolean;version?:number}>(`/cms/modules/${moduleId}/content${isDraft ? '/'+data.content!.version : ''}`,{method:isDraft?'PUT':'POST',body:JSON.stringify({htmlContent:doc.body.innerHTML})});
    if(result?.success){dirty=false;await mountLessonEditor(root,moduleId,api,back,result.version || data.content?.version);root.querySelector('#editor-status')!.textContent='Draft saved. Review the preview before publishing.';}
    else{status.textContent='Draft was not saved. Your edits remain here; retry when connected.';save.disabled=false;}
  };
  publish.onclick=async()=>{
    if(dirty || data.content?.status!=='draft')return;
    if(!confirm(`Publish saved version ${data.content.version}? It will become visible to reps.`))return;
    publish.disabled=true;save.disabled=true;status.textContent='Publishing saved draft…';
    const result=await api<{success:boolean}>(`/cms/modules/${moduleId}/publish`,{method:'POST',body:JSON.stringify({version:data.content.version})});
    if(result?.success){await mountLessonEditor(root,moduleId,api,back);root.querySelector('#editor-status')!.textContent='Published. Reps will receive this version when reopening the lesson.';}
    else{status.textContent='Publish failed. The saved draft remains available.';publish.disabled=false;save.disabled=false;}
  };
  preview();
}
