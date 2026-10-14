import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test('certificate is hidden before certification; certified reps download PDF and PNG from both screens', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => route.fulfill({status:503,contentType:'application/json',body:'{"offline":true}'}));
  await page.route('**/api/certificates/me', route => route.fulfill({json:{certificate:{recipientName:'Certificate QA',score:92,certificationDate:'2026-10-01T12:00:00Z',certificateId:'RER-2026-123456789ABC'}}}));
  await page.goto('/');
  await page.getByLabel('Your Name').fill('Certificate QA');
  await page.getByRole('button', {name:'Start Training',exact:true}).click();
  await expect(page.locator('#learning-path li')).toHaveCount(14);
  await expect(page.locator('#certificate-panel')).toBeHidden();
  await page.evaluate(() => {
    localStorage.setItem('roof-er.certifiedStatus', 'true');
    localStorage.setItem('roof-er.certificationDate', '2026-10-01T12:00:00Z');
    localStorage.setItem('roof-er.certificationScore', '92');
    localStorage.setItem('roof-er.examUserName', 'Certificate QA');
    localStorage.setItem('roof-er.unlockedModules', JSON.stringify(['welcome','final-exam']));
    (window as any).navigateToModule('my-page');
  });
  await expect(page.locator('#certificate-panel')).toBeVisible();
  await expect(page.locator('#certificate-summary')).toContainText('earned certificate');
  for (const screen of ['my-page','final-exam']) {
    await page.evaluate(id => (window as any).navigateToModule(id), screen);
    for (const format of ['PDF','PNG']) {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', {name:format === 'PDF' ? 'Download Certificate (PDF)' : 'Download PNG',exact:true}).click();
      const download = await pending;
      expect(download.suggestedFilename()).toBe(`RoofER_Certificate_Certificate_QA.${format.toLowerCase()}`);
      const bytes = await fs.readFile((await download.path())!);
      expect(bytes.length).toBeGreaterThan(10000);
      if (format === 'PDF') expect(bytes.subarray(0,8).toString()).toBe('%PDF-1.4');
      else expect(bytes.subarray(1,4).toString()).toBe('PNG');
      await download.saveAs(test.info().outputPath(`certificate-${screen}.${format.toLowerCase()}`));
    }
  }
  await expect(page.locator('.certified-screen')).toContainText('92%');
  expect(errors).toEqual([]);
});

for (const cms of [false, true]) {
  test(`${cms ? 'CMS admin' : 'manager'} downloads another representative's earned certificate`, async ({page}) => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const certificate = {userId,recipientName:'Morgan Certified',score:88,certificationDate:'2026-09-20T12:00:00Z',certificateId:'RER-2026-ABCDEF123456'};
    await page.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      let json: any = {success:true,valid:true,token:'admin-test',admin:{id:'admin',username:'qa',displayName:'Admin QA'},modules:[],questions:[],packs:[]};
      if (pathname.endsWith('/certificates')) json = {certificates:[certificate]};
      else if (pathname.includes('/certificates/')) json = {certificate};
      else if (pathname === '/api/admin/users') json = {users:[{id:userId,name:certificate.recipientName,isCertified:true,modulesCompleted:14,examAttempts:1}],totalUsers:1};
      else if (pathname === '/api/admin/users/' + userId) json = {user:{id:userId,name:certificate.recipientName},modules:[],examAttempts:[],roleplaySessions:[],certification:{certifiedAt:certificate.certificationDate,score:88},loginHistory:[]};
      else if (pathname.includes('/coaching/')) json = {practice:[],assignments:[]};
      else if (pathname.includes('/auth/')) return route.fulfill({status:503,json:{offline:true}});
      return route.fulfill({json});
    });
    if (cms) {
      await page.goto('/');
      await page.getByRole('button',{name:'Content editor sign in',exact:true}).click();
      await page.getByLabel('Admin Username',{exact:true}).fill('certificate-admin');
      await page.getByLabel('Admin Password',{exact:true}).fill('fixture-only');
      await page.getByRole('button',{name:'Admin Login',exact:true}).click();
      await page.getByRole('button',{name:'Certificates',exact:true}).click();
      await page.getByLabel('Find a certificate').fill('Morgan');
    } else {
      await page.goto('/');
      await page.getByLabel('Your Name').fill('Manager QA');
      await page.getByRole('button',{name:'Start Training',exact:true}).click();
      await page.evaluate(() => {localStorage.setItem('roof-er.userIsManager','true'); localStorage.setItem('roof-er.managerMode','true');});
      await page.reload();
      await page.locator('#learning-path').waitFor();
      await page.evaluate(() => (window as any).navigateToModule('admin-dashboard'));
      await page.getByRole('button',{name:'View Details',exact:true}).click();
    }
    for (const format of ['PDF','PNG']) {
      const pending = page.waitForEvent('download');
      await page.getByRole('button',{name:format === 'PDF' ? 'Download Certificate (PDF)' : 'Download PNG',exact:true}).click();
      const file = await pending;
      expect(file.suggestedFilename()).toBe('RoofER_Certificate_Morgan_Certified.' + format.toLowerCase());
    }
  });
}

test('missing earned record shows an error instead of generating a certificate from local state', async ({page}) => {
  await page.route('**/api/**', route => route.fulfill({status:503,json:{offline:true}}));
  await page.route('**/api/certificates/me', route => route.fulfill({status:404,json:{error:'No earned certificate is recorded for this representative.'}}));
  await page.goto('/');
  await page.getByLabel('Your Name').fill('No Certificate QA');
  await page.getByRole('button',{name:'Start Training',exact:true}).click();
  await page.evaluate(() => {localStorage.setItem('roof-er.certifiedStatus','true'); (window as any).navigateToModule('my-page');});
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByRole('button',{name:'Download Certificate (PDF)',exact:true}).click();
  await expect(page.locator('.certificate-download-status')).toContainText('No earned certificate');
  await expect(page.getByRole('button',{name:'Download Certificate (PDF)',exact:true})).toBeEnabled();
  expect(downloads).toBe(0);
});
