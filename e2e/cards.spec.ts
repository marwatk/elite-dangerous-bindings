import { Page, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function openFixture(page: Page): Promise<void> {
  // Use the <input type=file> fallback: Playwright can't drive the File System Access picker.
  await page.addInitScript(() => delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker);
  await page.goto('/');
  const text = readFileSync('src/testing/fixtures/Custom.4.2.binds', 'utf-8');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open your bindings file/ }).click();
  await (await chooser).setFiles({ name: 'Custom.4.2.binds', mimeType: 'application/xml', buffer: Buffer.from(text) });
  await expect(page).toHaveURL(/\/bindings$/);
  await page.getByRole('link', { name: 'Reference cards' }).click();
  await expect(page).toHaveURL(/\/cards$/);
}

test('cards page asks for a file when none is open', async ({ page }) => {
  await page.goto('/cards');
  await expect(page.getByText('Open a bindings file to make printable reference cards')).toBeVisible();
  await expect(page.getByRole('link', { name: /Go to Home/ })).toBeVisible();
});

test('reference cards: keyboard card, colour schemes and SVG download', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openFixture(page);

  const keyboard = page.getByRole('region', { name: 'Keyboard' });
  await expect(keyboard.locator('svg')).toContainText('Boost', { timeout: 30_000 });
  await expect(keyboard.locator('svg')).toContainText('Hyperspace/Supercruise');
  // Device cards for the controllers in the fixture.
  await expect(page.getByRole('region', { name: /T\.Flight HOTAS X/i })).toBeVisible();
  // Mouse bindings are listed rather than silently dropped.
  await expect(page.getByRole('heading', { name: 'Not shown on any card' })).toBeVisible();

  // "By group": Boost is a Ship command, drawn in the Ship colour.
  await page.getByRole('radio', { name: 'By group' }).check();
  const boost = keyboard.locator('tspan', { hasText: /^Boost$/ }).first();
  await expect(boost).toHaveAttribute('fill', '#c8102e');
  await page.getByRole('radio', { name: 'No colours' }).check();
  await expect(boost).toHaveAttribute('fill', '#111111');

  // Group filter removes SRV-only text.
  await expect(keyboard.locator('svg')).toContainText('Handbrake');
  await page.getByRole('checkbox', { name: 'SRV' }).uncheck();
  await expect(keyboard.locator('svg')).not.toContainText('Handbrake');
  await page.getByRole('checkbox', { name: 'SRV' }).check();

  const download = page.waitForEvent('download');
  await keyboard.getByRole('button', { name: /SVG/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/Keyboard\.svg$/);
  const svg = readFileSync(await file.path(), 'utf-8');
  expect(svg).toContain('<svg');
  expect(svg).toContain('Boost');
});
