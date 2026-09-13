import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir} from 'node:fs/promises';
const speech='I will check the shingles, flashing and vents, document collateral damage, and share the photos with you.';
async function open(page:Page){

  await page.goto('/');await page.getByLabel('Your Name').fill('Local Inspection QA');await page.getByRole('button',{name:'Start Training',exact:true}).click();
  await page.locator('#learning-path').waitFor();await page.evaluate(()=>localStorage.setItem('roof-er.unlockedModules',JSON.stringify(['welcome','inspection-process','role-play'])));
  await page.evaluate(()=>(window as any).navigateToModule('role-play'));await expect(page.locator('.inspection-practice')).toBeVisible();
}
async function provider(page:Page,{failSave=false,failFeedback=false,disconnect=false}={}){
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{offline:true}}));
  let instruction='',saved:any=null,saves=0,feedbackCalls=0;let ws:any;
  await page.route('**/api/ai/gemini-token',route=>{instruction=route.request().postDataJSON().systemInstruction;return route.fulfill({json:{token:'auth_tokens/local-test',model:'gemini-2.5-flash-native-audio-preview-12-2025'}});});
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/,socket=>{
    ws=socket;
    socket.onMessage(raw=>{const message=JSON.parse(String(raw));
      if(message.setup)socket.send(JSON.stringify({setupComplete:{}}));
      if(message.clientContent){socket.send(JSON.stringify({serverContent:{inputTranscription:{text:speech,finished:true},outputTranscription:{text:'Can I see the photos?',finished:true},turnComplete:true}}));if(disconnect)setTimeout(()=>socket.close(),100);}
    });
  });
  await page.route('**/api/ai/inspection-feedback',route=>{
    feedbackCalls++;const data=route.request().postDataJSON();
    if(failFeedback&&feedbackCalls===1)return route.fulfill({status:503,json:{error:'Feedback unavailable'}});
    return route.fulfill({json:{success:true,aiScored:true,feedback:{summary:'You explained the inspection clearly.',criteria:data.scenario.expectedKeyPoints.map((point:string)=>({point,status:'covered',evidence:'check the shingles',nextStep:'Practice explaining how you document the findings.'}))}}});
  });
  await page.route('**/api/roleplay/inspection-save',route=>{saves++;saved=route.request().postDataJSON();return route.fulfill(failSave&&saves===1?{status:503,json:{error:'Save unavailable'}}:{json:{success:true,sessionId:saved.id}});});
  return {instruction:()=>instruction,saved:()=>saved,saves:()=>saves,close:()=>ws?.close()};
}
test('rookie inspection briefing matches the live SDK request, debrief and durable save',async({page})=>{
  const mock=await provider(page);await open(page);
  const prompt=await page.locator('#inspection-prompt').innerText();
  await page.getByRole('button',{name:'Start voice practice',exact:true}).click();
  await expect(page.locator('#inspection-state')).toContainText('Ready.');
  expect(mock.instruction()).toContain(prompt);expect(mock.instruction()).toContain('ROOKIE / EASY');
  await expect(page.getByRole('button',{name:'Medium',exact:true})).toHaveCount(0);
  await expect(page.locator('#inspection-transcript')).toContainText(speech);
  await page.getByRole('button',{name:'Mute microphone',exact:true}).click();
  await expect(page.getByRole('button',{name:'Unmute microphone',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'End & review',exact:true}).click();
  await expect(page.locator('#inspection-feedback')).toContainText('AI-scored practice: 100/100');
  await expect(page.locator('#inspection-save-status')).toContainText('saved to your training record');
  expect(mock.saved().scenario.prompt).toBe(prompt);expect(mock.saved().difficulty).toBe('BEGINNER');expect(mock.saved().transcript.some((t:any)=>t.role==='user')).toBe(true);expect(mock.saves()).toBe(1);
  await mkdir('output/playwright',{recursive:true});
  for(const width of [1280,390])for(const theme of ['light','dark']){await page.setViewportSize({width,height:900});await page.getByLabel('Appearance').selectOption(theme);await expect.poll(async()=> (await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo(0,0);});await page.screenshot({path:`output/playwright/inspection-${width}-${theme}.png`,fullPage:true});}
});
test('feedback and save failures retain the transcript and allow focused retries',async({page})=>{
  const mock=await provider(page,{failSave:true,failFeedback:true});await open(page);
  await page.getByRole('button',{name:'Start voice practice',exact:true}).click();await expect(page.locator('#inspection-state')).toContainText('Ready.');
  await page.getByRole('button',{name:'End & review',exact:true}).click();
  await expect(page.locator('#inspection-debrief')).toBeVisible();await expect.poll(()=>mock.saves()).toBe(1);
  await expect(page.locator('#inspection-feedback')).toContainText('No AI score');await expect(page.locator('#inspection-save-status')).toContainText('not confirmed');
  const id=mock.saved().id;await page.getByRole('button',{name:'Retry feedback',exact:true}).click();
  await expect(page.locator('#inspection-feedback')).toContainText('100/100');await expect(page.locator('#inspection-save-status')).toContainText('saved to your training record');expect(mock.saved().id).toBe(id);
});
test('denied microphone and provider disconnect do not silently complete practice',async({page})=>{
  await provider(page);await open(page);
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));});
  await page.getByRole('button',{name:'Start voice practice',exact:true}).click();await expect(page.locator('#inspection-state')).toContainText('denied');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('roof-er.completedModules')||'[]'))).not.toContain('role-play');
});
test('disconnect keeps captured speech and retry starts the same inspection scenario',async({page})=>{
  await provider(page,{disconnect:true});await open(page);const prompt=await page.locator('#inspection-prompt').innerText();
  await page.getByRole('button',{name:'Start voice practice',exact:true}).click();await expect(page.locator('#inspection-state')).toContainText('interrupted');
  await expect(page.locator('#inspection-transcript')).toContainText(speech);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('roof-er.completedModules')||'[]'))).not.toContain('role-play');
  await page.getByRole('button',{name:'Retry same scenario',exact:true}).click();await expect(page.locator('#inspection-prompt')).toHaveText(prompt);
});
