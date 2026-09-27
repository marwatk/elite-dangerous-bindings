import { Page, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Visual check screenshots for the bindings feature:
//   npm run shots -- bindings
const OUT = process.env['SHOTS_DIR'] ?? 'test-results/shots/bindings';
const text = readFileSync('src/testing/fixtures/Custom.4.2.binds', 'utf-8');

test.setTimeout(180_000);

async function open(page: Page, light: boolean): Promise<void> {
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.addInitScript((light) => {
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
    try {
      localStorage.setItem('edb.theme', light ? 'light' : 'dark');
      localStorage.removeItem('edb.bindings.view');
    } catch {
      /* ignore */
    }
  }, light);
  await page.goto('/');
  await page.waitForTimeout(500);
  const overlay = await page.evaluate(() => {
    const o = document.querySelector('vite-error-overlay');
    const t = o?.shadowRoot?.textContent ?? null;
    o?.remove();
    return t;
  });
  if (overlay) console.log('DEV SERVER ERROR OVERLAY (removed):', overlay.slice(0, 400));
  await page.evaluate((light) => document.documentElement.classList.toggle('light', light), light);
  // The nav drawer overlays the page on phones.
  if ((page.viewportSize()?.width ?? 1000) < 800) await page.keyboard.press('Escape');
  for (let attempt = 0; ; attempt++) {
    try {
      const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
      await page.getByRole('button', { name: /Open your bindings file/ }).click({ timeout: 10_000 });
      await (await chooser).setFiles({ name: 'Custom.4.2.binds', mimeType: 'application/xml', buffer: Buffer.from(text) });
      break;
    } catch (e) {
      // The dev server may reload the page mid-way when other files change.
      if (attempt >= 2) throw e;
      await page.goto('/');
      if ((page.viewportSize()?.width ?? 1000) < 800) await page.keyboard.press('Escape');
    }
  }
  await expect(page).toHaveURL(/\/bindings$/);
  await page.evaluate((light) => document.documentElement.classList.toggle('light', light), light);
  await page.waitForTimeout(1200);
}

for (const [width, light] of [
  [1400, false],
  [1400, true],
  [390, false],
  [390, true],
] as const) {
  const tag = `${width}-${light ? 'light' : 'dark'}`;
  test(`shots ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await open(page, light);
    await page.evaluate(() => document.querySelector('mat-sidenav-content')?.scrollTo(0, 0));
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${OUT}/table-${tag}.png` });
    await page.evaluate(() => document.querySelector('mat-sidenav-content')?.scrollTo(0, 400));
    await page.screenshot({ path: `${OUT}/table-scrolled-${tag}.png` });
    await page.evaluate(() => document.querySelector('mat-sidenav-content')?.scrollTo(0, 0));
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(tag, 'scrollWidth/innerWidth', sw);

    await page.getByLabel('Filter commands').fill('landing gear');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/filtered-${tag}.png` });
    await page.getByRole('row', { name: /Edit Landing Gear/ }).first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/editor-${tag}.png` });
    await page.getByRole('button', { name: /Press to bind/ }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/editor-capture-${tag}.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Pick from list/ }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/editor-pick-${tag}.png` });
    await page.getByLabel('Find a control').fill('F9');
    await page.getByRole('button', { name: /^F9/ }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/editor-picked-${tag}.png` });
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(300);

    await page.getByLabel('Filter commands').fill('yaw');
    await page.getByRole('row', { name: /Edit Yaw Axis/ }).first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/editor-axis-${tag}.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.getByLabel('Filter commands').fill('');

    for (const [btn, name] of [
      ['Warnings', 'warnings'],
      ['Changes', 'changes'],
      ['Settings', 'settings'],
      ['Merge', 'merge'],
      ['Export / install', 'export'],
    ]) {
      await page.getByRole('button', { name: new RegExp(`^${btn.replace('/', '\\/')}`) }).click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    await page.getByRole('button', { name: 'Bulk actions' }).click();
    await page.getByRole('menuitem', { name: /Move a device/ }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/bulk-${tag}.png` });
  });
}
