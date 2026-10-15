import {test, expect} from '@playwright/test';

test('admin rows align and saved test location remains readable in both themes and on phones', async ({page}) => {
  const users = ['Anthony Paris', 'Anthony Keith Anders With A Longer Name'].map((name, i) => ({id: String(i), name,
    isManager: false, modulesCompleted: 2, examAttempts: 0, isCertified: false, lastLogin: new Date().toISOString()}));
  const grid = {totalUsers: 2, userProgress: users.map(u => ({userId: u.id, userName: u.name, lastLogin: u.lastLogin,
    currentModule: 'final-exam', moduleStatus: [{module: 'welcome', status: 'completed'}, {module: 'final-exam', status: 'in_progress'}],
    exam: {status: 'in_progress', attemptNumber: 1, answered: 12, total: 56, currentQuestion: 'fib-2', savedAt: new Date().toISOString(),
      sections: [{section: 'mcq', answered: 10, total: 35}, {section: 'fib', answered: 2, total: 11}, {section: 'sa', answered: 0, total: 10}]}}))};
  let refreshes = 0;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/admin/users') return route.fulfill({json: {users}});
    if (path === '/api/admin/progress-grid') { refreshes++; return route.fulfill({json: grid}); }
    return route.fulfill({status: 503, json: {offline: true}});
  });
  await page.goto('/');
  await page.getByLabel('Your Name').fill('Manager UI QA');
  await page.getByRole('button', {name: 'Start Training', exact: true}).click();
  await expect(page.locator('#learning-path li')).toHaveCount(14);
  await page.evaluate(() => {localStorage.setItem('roof-er.userIsManager', 'true'); localStorage.setItem('roof-er.managerMode', 'true');});
  await page.reload();
  await expect(page.locator('#learning-path li')).toHaveCount(14);
  await page.evaluate(() => (window as any).navigateToModule('admin-dashboard'));
  await expect(page.locator('.admin-table tbody tr')).toHaveCount(2);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await page.setViewportSize({width: 1440, height: 1000});
    await page.locator('[data-tab="users"]').click();
    const aligned = await page.locator('.admin-table tbody tr').evaluateAll(rows => rows.every(row => {
      const cells = Array.from(row.children).map(cell => cell.getBoundingClientRect());
      return cells.every(cell => Math.abs(cell.bottom - cells[0].bottom) < 1 && Math.abs(cell.top - cells[0].top) < 1);
    }));
    expect(aligned).toBe(true);
    await page.screenshot({path: test.info().outputPath(`admin-users-${theme}.png`), fullPage: true});
    await page.locator('[data-tab="progress-grid"]').click();
    await expect(page.locator('.exam-progress-col').nth(1)).toContainText('12 of 56 answered');
    await expect(page.locator('.exam-progress-col').nth(1)).toContainText('Fill in the blank · Question 3');
    expect(await page.locator('.progress-grid-table .user-name').evaluateAll(names => names.every(name => name.scrollWidth <= name.clientWidth))).toBe(true);
    await page.screenshot({path: test.info().outputPath(`admin-progress-${theme}.png`), fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('[data-tab="progress-grid"]')).toBeInViewport();
    expect(await page.locator('.exam-progress-col').nth(1).evaluate(el => {
      const rect = el.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth;
    })).toBe(true);
    expect(await page.locator('.progress-grid-table .user-name').evaluateAll(names => names.every(name => name.scrollWidth <= name.clientWidth))).toBe(true);
    await page.screenshot({path: test.info().outputPath(`admin-progress-${theme}-mobile.png`), fullPage: true});
  }
  await expect.poll(() => refreshes, {timeout: 20000}).toBeGreaterThan(2);
});
