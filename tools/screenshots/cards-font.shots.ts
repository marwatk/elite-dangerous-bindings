import { Page, expect, test } from '@playwright/test';
import { fixture, remap } from './fixtures';

// Before/after screenshots of EDRefCard device cards, for checking changes to
// the card text sizing: `FONT_SHOTS=before npm run shots -- cards-font`, change
// the code, then `FONT_SHOTS=after …`. Output:
// test-results/shots/devices-leaders/font-<FONT_SHOTS>-*.png.

const TAG = process.env['FONT_SHOTS'] ?? 'current';
test.use({ deviceScaleFactor: 2 });

/** The tracked X52 fixture moved onto the X56 and HOTAS Cougar cards. */
const x56 = () => remap(fixture('X52.4.2.binds'), 'SaitekX52', 'SaitekX56Joystick', 'X56 test');
const cougar = () => remap(fixture('X52.4.2.binds'), 'SaitekX52', '044F0400', 'Cougar test');

async function open(page: Page, name: string, text: string): Promise<void> {
  await page.addInitScript(() => delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open your bindings file/ }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/xml', buffer: Buffer.from(text) });
  await expect(page).toHaveURL(/\/bindings$/);
  await page.getByRole('link', { name: 'Reference cards' }).click();
  await page.locator('app-card-svg svg').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
}

for (const [label, name, text] of [
  ['x56', 'SaitekX56.binds', x56],
  ['cougar', 'Cougar.binds', cougar],
] as const) {
  test(`card text size: ${label}`, async ({ page }) => {
    await page.setViewportSize({ width: 1700, height: 1100 });
    await open(page, name, text());
    await page.locator('app-card-svg').first().screenshot({ path: `test-results/shots/devices-leaders/font-${TAG}-${label}.png` });
  });
}
