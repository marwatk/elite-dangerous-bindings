import { Page, expect, test } from '@playwright/test';
import { fixture, remap, upstream } from './fixtures';

// Visual check of the reference cards for several controllers:
// `npm run shots -- cards`. Screenshots go to test-results/shots/cards/.
// Uses tracked fixtures (the X52 file moved onto other controllers' IDs);
// EDRefCard's presets are added when upstream/ has been fetched.

interface Sample {
  name: string;
  text: () => string | null;
}

const x52 = () => fixture('X52.4.2.binds');
const FILES: Sample[] = [
  { name: 'Custom.4.2.binds', text: () => fixture('Custom.4.2.binds') },
  { name: 'X56.binds', text: () => remap(x52(), 'SaitekX52', 'SaitekX56Joystick', 'X56 test') },
  { name: 'X52.4.2.binds', text: x52 },
  { name: 'Warthog.binds', text: () => remap(x52(), 'SaitekX52', 'ThrustMasterWarthogJoystick', 'Warthog test') },
  { name: 'VKB-NXT-Right.binds', text: () => remap(x52(), 'SaitekX52', '231D0200', 'VKB test') },
  { name: 'T16000M.binds', text: () => remap(x52(), 'SaitekX52', 'T16000M', 'T.16000M test') },
  // Gamepads use their own key names, so there's no fixture to remap: EDRefCard's preset if fetched.
  { name: 'ConsoleX360.binds', text: () => upstream('edrefcard2/bindings/Defaults ODY patch 8/ConsoleX360.binds') },
];

test.use({ deviceScaleFactor: 2.5 });

async function open(page: Page, sample: Sample): Promise<void> {
  const text = sample.text();
  test.skip(text === null, `${sample.name} needs upstream/ (run tools/fetch-upstream.sh)`);
  await page.addInitScript(() => delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open your bindings file/ }).click();
  await (await chooser).setFiles({ name: sample.name, mimeType: 'application/xml', buffer: Buffer.from(text!) });
  await expect(page).toHaveURL(/\/bindings$/);
  await page.getByRole('link', { name: 'Reference cards' }).click();
  await expect(page).toHaveURL(/\/cards$/);
  await page.locator('app-card-svg svg').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
}

for (const sample of FILES) {
  test(`cards for ${sample.name}`, async ({ page }) => {
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
    await open(page, sample);
    const tag = sample.name.replace(/\W+/g, '_');
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
