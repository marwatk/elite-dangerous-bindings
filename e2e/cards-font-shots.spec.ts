import { Page, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Before/after screenshots of EDRefCard device cards, for checking changes to
// the card text sizing. Not part of the normal run:
// `FONT_SHOTS=before npx playwright test e2e/cards-font-shots.spec.ts`
// Screenshots go to test-results/shots/devices-leaders/font-<FONT_SHOTS>-*.png.

const TAG = process.env['FONT_SHOTS'];
test.skip(!TAG, 'Set FONT_SHOTS=before|after to take card screenshots');
test.setTimeout(120_000);
test.use({ deviceScaleFactor: 2 });

const X56 = readFileSync('upstream/edrefcard2/bindings/Defaults ODY patch 8/SaitekX56.binds', 'utf8');
/** No Cougar file upstream: the X56 defaults moved onto a HOTAS Cougar. */
const COUGAR = X56.replace(/SaitekX56Joystick|SaitekX56Throttle/g, '044F0400').replace(/PresetName="[^"]*"/, 'PresetName="Cougar test"');

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
  ['x56', 'SaitekX56.binds', X56],
  ['cougar', 'Cougar.binds', COUGAR],
] as const) {
  test(`card text size: ${label}`, async ({ page }) => {
    await page.setViewportSize({ width: 1700, height: 1100 });
    await open(page, name, text);
    await page.locator('app-card-svg').first().screenshot({ path: `test-results/shots/devices-leaders/font-${TAG}-${label}.png` });
  });
}
