import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test('certificate is hidden before certification; certified reps download PDF and PNG from both screens', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => route.fulfill({status:503,contentType:'application/json',body:'{"offline":true}'}));
  await page.goto('/');
  await page.getByLabel('Your Name').fill('Certificate QA');
  await page.getByRole('button', {name:'Start Training',exact:true}).click();
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
  await expect(page.locator('#certificate-summary')).toContainText('Score 92%');
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
