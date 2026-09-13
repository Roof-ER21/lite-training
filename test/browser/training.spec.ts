import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';

const modules = ['welcome','commitment','general-knowledge','shingle-types-materials','initial-pitch','handling-initial-pitch-objections','damage-identification','inspection-process','post-inspection-pitch','post-inspection-objections','filing-claim-closing','sales-cycle-job-flow','role-play','final-exam'];
async function login(page: Page) {
  await page.route('**/api/**', route => route.fulfill({status:503,contentType:'application/json',body:'{"offline":true}'}));
  await page.route('https://raw.githubusercontent.com/**', route => route.abort());
  await page.goto('/');
  await page.getByLabel('Your Name').fill('Local Training QA');
  await page.getByRole('button',{name:'Start Training',exact:true}).click();
  await expect(page.locator('#learning-path li')).toHaveCount(14);
}
async function openLesson(page: Page, id: string) {
  await page.evaluate(id => (window as any).navigateToModule(id),id);
  await expect(page.locator('#main-content')).toHaveAttribute('data-lesson',id);
}

for (const theme of ['light','dark']) {
  test(`${theme}: mobile lessons have no WCAG violations or page overflow`, async ({page}) => {
    const errors: string[] = [];
    page.on('pageerror',error => errors.push(error.message));
    await page.setViewportSize({width:390,height:844});
    await login(page);
    await page.evaluate(ids => localStorage.setItem('roof-er.unlockedModules',JSON.stringify(ids)),modules);
    for (const id of ['my-page',...modules]) {
      await openLesson(page,id);
      await page.getByLabel('Appearance').selectOption(theme);
      await page.waitForTimeout(200);
      const result = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      expect(result.violations, `${theme}: ${id}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),`${theme}: ${id} overflow`).toBe(true);
      expect(await page.locator('#main-content').innerText()).not.toMatch(/Total XP|Day Streak|Time Trained|Next Milestone|Leaderboard|\[object Object\]|\bundefined\b/);
    }
    expect(errors).toEqual([]);
  });
}

test('drawer, keyboard exercises, completion choice, and stored records', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await login(page);
  await expect(page.locator('[data-lesson="final-exam"]')).toBeDisabled();
  await page.getByRole('button',{name:'Lessons',exact:true}).click();
  await expect(page.locator('#training-menu')).toHaveAttribute('aria-expanded','true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#training-menu')).toBeFocused();
  await page.locator('#continue-training-btn').click();
  await expect(page.locator('#main-content')).toHaveAttribute('data-lesson','welcome');
  await page.evaluate(ids => {
    localStorage.setItem('roof-er.unlockedModules',JSON.stringify(ids));
    localStorage.setItem('commitment-signer-name','Saved Training QA');
    localStorage.setItem('commitment-signed-date','2026-09-01');
    localStorage.setItem('roof-er.totalXp','700');
    localStorage.setItem('roof-er.streak','4');
    localStorage.setItem('roof-er.finalExamHistory',JSON.stringify([{attemptNumber:1,totalScore:60,passed:false,date:'2026-09-01'}]));
  },modules);
  await openLesson(page,'handling-initial-pitch-objections');
  const flip = page.locator('button.objection-flip-card').first();
  await expect(flip).toBeVisible();
  await flip.focus(); await page.keyboard.press('Enter');
  await expect(flip).toHaveAttribute('aria-pressed','true');
  await openLesson(page,'inspection-process');
  await page.locator('#inspection-items-pool [data-order="1"] .sequence-move').click();
  await expect(page.locator('#inspection-sorted-list [data-order="1"]')).toBeVisible();
  await page.evaluate(() => (window as any).completeModule('welcome'));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(3200);
  await expect(dialog).toBeVisible();
  await page.getByRole('button',{name:'Stay here',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  const records = await page.evaluate(() => ({name:localStorage.getItem('commitment-signer-name'),date:localStorage.getItem('commitment-signed-date'),history:JSON.parse(localStorage.getItem('roof-er.finalExamHistory')!)}));
  expect(records).toEqual({name:'Saved Training QA',date:'2026-09-01',history:[{attemptNumber:1,totalScore:60,passed:false,date:'2026-09-01'}]});
});

test('theme persistence, system preference, and accessible exam form', async ({page}) => {
  await login(page);
  await page.getByLabel('Appearance').selectOption('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByLabel('Appearance').selectOption('system');
  await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.evaluate(ids => localStorage.setItem('roof-er.unlockedModules',JSON.stringify(ids)),modules);
  await openLesson(page,'final-exam');
  await page.locator('#exam-user-name').fill('Local Training QA');
  await page.locator('#startFinalExam').click();
  await expect(page.locator('.exam-question')).toHaveCount(56);
  for (const theme of ['light','dark']) {
    await page.getByLabel('Appearance').selectOption(theme);
    await page.waitForTimeout(200);
    const result = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    expect(result.violations,`exam form ${theme}`).toEqual([]);
  }
});

test('field search, saved references, recall feedback, checklist, and captions', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await login(page);
  await page.evaluate(ids => localStorage.setItem('roof-er.unlockedModules',JSON.stringify(ids)),modules);
  await page.getByRole('button',{name:'Field library',exact:true}).click();
  await page.getByLabel('Search the library').fill('photo documentation');
  const result=page.locator('.reference-result').first();
  await expect(result).toBeVisible();
  await result.getByRole('button',{name:'Save reference',exact:true}).click();
  await expect(result.getByRole('button',{name:'Saved',exact:true})).toHaveAttribute('aria-pressed','true');
  await result.getByRole('button',{name:'Open section',exact:true}).click();
  await expect(page.locator('#main-content')).toHaveAttribute('data-lesson','inspection-process');
  await page.getByRole('button',{name:'Practice recall',exact:true}).click();
  await page.getByLabel('Your explanation').fill('I will explain the inspection sequence and pair a close-up with an overview.');
  await page.getByRole('button',{name:'Compare with the lesson',exact:true}).click();
  await expect(page.locator('#recall-feedback')).toContainText('This is a self-review');
  await page.getByRole('button',{name:'Needs more practice',exact:true}).click();
  await expect(page.locator('#recall-saved')).toContainText('Added');
  const checklist=page.locator('.field-checklist input').first();await checklist.check();
  await openLesson(page,'my-page');
  await expect(page.locator('.practice-review')).toContainText('Inspection');
  await openLesson(page,'inspection-process');
  await expect(page.locator('.field-checklist input').first()).toBeChecked();
  await expect(page.getByRole('button',{name:'Resume last section',exact:true})).toBeVisible();
  await expect(page.locator('video track[kind="captions"]').first()).toHaveAttribute('src',/module8-inspection-process.vtt/);
  await page.getByText('Read or search the video transcript',{exact:true}).first().click();
  await page.getByLabel('Find in this video').first().fill('safety');
  await expect(page.locator('.transcript-cues')).toContainText('Safety');
  for(const theme of ['light','dark']){
    await page.getByLabel('Appearance').selectOption(theme);
    await expect.poll(async()=> (await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  }
  await page.getByRole('button',{name:'Field library',exact:true}).click();
  await page.getByLabel('Show',{exact:true}).selectOption('saved');
  await expect(page.locator('.reference-result')).toHaveCount(1);
  await expect(page.locator('.reference-result')).toContainText('Photo Documentation');
});

test('structured lesson editor saves a new draft and publishes only saved content', async ({page}) => {
  let version=1,status='published',html='<div class="content-card"><h1>Inspection lesson</h1><h2>Documentation</h2><p>Pair a close-up with an overview.</p><button id="preserved-exercise">Existing exercise</button></div>';
  const writes:any[]=[];

  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()); const body=route.request().postDataJSON();
    let response:any={success:true,valid:true,token:'local-admin',admin:{id:'local-admin',username:'qa',displayName:'Local Editor'}};
    if(url.pathname==='/api/cms/modules')response={modules:[{id:'inspection-process',title:'Inspection lesson',status,latestVersion:version}]};
    else if(url.pathname==='/api/cms/exam/questions')response={questions:[]};
    else if(url.pathname==='/api/cms/scenarios/packs')response={packs:[]};
    else if(url.pathname==='/api/cms/modules/inspection-process')response={module:{title:'Inspection lesson'},content:{version,status,htmlContent:html},versions:[{version,status}]};
    else if(url.pathname.endsWith('/content')) {writes.push({method:route.request().method(),body});html=body.htmlContent;version++;status='draft';response={success:true,version};}
    else if(url.pathname.endsWith('/publish')) {writes.push({method:'publish',body});status='published';}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Content editor sign in',exact:true}).click();
  await page.getByLabel('Admin Username',{exact:true}).fill('local-editor');
  await page.getByLabel('Admin Password',{exact:true}).fill('local-fixture-only');
  await page.getByRole('button',{name:'Admin Login',exact:true}).click();
  await page.locator('.sa-nav-item[data-section="modules"]').click();
  await page.getByRole('button',{name:'Edit Content',exact:true}).click();
  await page.getByLabel('Worked example',{exact:true}).fill('Photograph the detail, then document its location.');
  await expect(page.getByRole('button',{name:'Publish saved draft',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.locator('#editor-status')).toContainText('Draft saved');
  expect(writes[0].method).toBe('POST');
  expect(writes[0].body.htmlContent).toContain('id="preserved-exercise"');
  expect(writes[0].body.htmlContent).toContain('Photograph the detail');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Publish saved draft',exact:true}).click();
  await expect(page.locator('#editor-status')).toContainText('Published');
  expect(writes[1]).toEqual({method:'publish',body:{version:2}});
});

test('source video decodes, plays, and loads a native caption track', async ({page}) => {
  await login(page);
  await page.route('https://raw.githubusercontent.com/**/welcome-intro.mp4',route=>route.fulfill({path:path.resolve('public/assets/training/videos/welcome-intro.mp4'),contentType:'video/mp4'}));
  await openLesson(page,'welcome');
  const video=page.locator('video').first();
  await expect(video.locator('track')).toHaveAttribute('label','English (automatic)');
  await video.evaluate(async (element:HTMLVideoElement)=>{element.muted=true;await element.play();element.textTracks[0].mode='showing';});
  await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.currentTime)).toBeGreaterThan(1);
  await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.textTracks[0].cues?.length || 0)).toBeGreaterThan(0);
  await video.evaluate((element:HTMLVideoElement)=>element.pause());
});

test('manager assigns practice through rep details and sees the saved note', async ({page}) => {
  await login(page);
  const id='11111111-1111-4111-8111-111111111111';
  const rep={id,name:'Local Rep',isManager:false,registrationDate:'2026-09-01',lastLogin:null,modulesCompleted:0,totalModules:14,isCertified:false};
  let assignments:any[]=[];
  await page.route('**/api/admin/users',route=>route.fulfill({json:{users:[rep],totalUsers:1}}));
  await page.route(`**/api/admin/users/${id}`,route=>route.fulfill({json:{user:rep,modules:[],examAttempts:[],roleplaySessions:[],certification:null,gamification:null,loginHistory:[]}}));
  await page.route(`**/api/coaching/users/${id}`,route=>route.fulfill({json:{practice:[{module_name:'inspection-process',section_title:'Photo documentation',status:'needs_practice'}],assignments}}));
  await page.route('**/api/coaching/assignments',route=>{
    const body=route.request().postDataJSON();
    expect(body.userId).toBe(id);
    assignments=[{id:'local-assignment',module_name:body.module,note:body.note,status:'assigned'}];
    return route.fulfill({json:{success:true,assignment:{id:'local-assignment'}}});
  });
  await page.evaluate(()=>{localStorage.setItem('roof-er.userIsManager','true');localStorage.setItem('roof-er.managerMode','true');});
  await page.reload();
  await page.locator('#learning-path').waitFor();
  await openLesson(page,'admin-dashboard');
  await page.getByRole('button',{name:'View Details',exact:true}).click();
  await expect(page.locator('.coaching-panel')).toContainText('Photo documentation');
  await page.getByLabel('Assign a lesson',{exact:true}).selectOption('inspection-process');
  await page.getByLabel('Coaching note shared with the rep',{exact:true}).fill('Bring one clear close-up and its matching overview to our review.');
  await page.getByRole('button',{name:'Assign practice',exact:true}).click();
  await expect(page.locator('.coaching-record')).toContainText('Bring one clear close-up');
  await expect(page.locator('.coaching-panel form [role="status"]')).toContainText('Practice assigned');
});
