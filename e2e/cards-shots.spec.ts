import { Page, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

// Visual check of the reference cards for several real files. Not part of the
// normal run: `CARD_SHOTS=1 npx playwright test e2e/cards-shots.spec.ts`.
// Screenshots go to test-results/shots/cards/.

const FILES = [
  'src/testing/fixtures/Custom.4.2.binds',
  'upstream/edrefcard2/bindings/Defaults ODY patch 8/SaitekX56.binds',
  'upstream/edrefcard2/bindings/Defaults ODY patch 8/ThrustMasterHOTASWarthog.binds',
  'upstream/edrefcard2/bindings/working/VKB Gladiator NXT Premium Left and Right.binds',
  'upstream/edrefcard2/bindings/Defaults ODY patch 8/ConsoleX360.binds',
  'upstream/edrefcard2/bindings/Defaults ODY patch 8/T16000MHOTAS.binds',
];

test.skip(!process.env['CARD_SHOTS'], 'Set CARD_SHOTS=1 to take card screenshots');
test.setTimeout(180_000);
test.use({ deviceScaleFactor: 2.5 });

async function open(page: Page, path: string): Promise<void> {
  await page.addInitScript(() => delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open your bindings file/ }).click();
  await (await chooser).setFiles({ name: basename(path), mimeType: 'application/xml', buffer: readFileSync(path) });
  await expect(page).toHaveURL(/\/bindings$/);
  await page.getByRole('link', { name: 'Reference cards' }).click();
  await expect(page).toHaveURL(/\/cards$/);
  await page.locator('app-card-svg svg').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
}

for (const path of FILES) {
  test(`cards for ${basename(path)}`, async ({ page }) => {
    await page.setViewportSize({ width: 1700, height: 1100 });
    const scheme = process.env['CARD_SCHEME'];
    if (scheme || process.env['CARD_OPTS']) {
      await page.addInitScript(
        ([s, o]) =>
          localStorage.setItem(
            'edb.cards.options',
            JSON.stringify({ scheme: s || 'group', ...(o ? JSON.parse(o) : {}) }),
          ),
        [scheme ?? '', process.env['CARD_OPTS'] ?? ''],
      );
    }
    await open(page, path);
    const tag = basename(path).replace(/\W+/g, '_');
    await page.screenshot({ path: `test-results/shots/cards/${tag}-page.png` });
    const cards = page.locator('app-card-svg');
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      await cards.nth(i).screenshot({ path: `test-results/shots/cards/${tag}-card${i}.png` });
    }
  });
}

test('phone layout and print', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await open(page, FILES[1]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/shots/cards/phone.png' });
  const wide = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await open(wide, FILES[1]);
  await wide.emulateMedia({ media: 'print' });
  await wide.pdf({ path: 'test-results/shots/cards/print.pdf', format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
});

test('png and pdf downloads', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await open(page, FILES[1]);
  const card = page.getByRole('region', { name: /X56/ });
  let dl = page.waitForEvent('download');
  await card.getByRole('button', { name: /PNG/ }).click();
  await (await dl).saveAs('test-results/shots/cards/download.png');
  dl = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: /PDF/ }).click();
  await (await dl).saveAs('test-results/shots/cards/download.pdf');
  dl = page.waitForEvent('download');
  await card.getByRole('button', { name: /SVG/ }).click();
  await (await dl).saveAs('test-results/shots/cards/download.svg');
});
