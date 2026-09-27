import { Page, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * The headline feature end to end: open a file, open the binding editor,
 * "Press to bind", press/move a (fake) physical control, and see the binding
 * land in the table and in the exported file.
 *
 * The controller is a fake Logitech/Saitek X56 stick (USB 0738:2221) reported
 * through the Gamepad API; WebHID is hidden so no permission dialog appears.
 */

const FIXTURE = readFileSync('src/testing/fixtures/Custom.4.2.binds', 'utf-8');

type FakePad = {
  index: number;
  id: string;
  mapping: string;
  connected: boolean;
  timestamp: number;
  buttons: { pressed: boolean; touched: boolean; value: number }[];
  axes: number[];
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const pad: FakePad = {
      index: 0,
      id: 'Saitek Pro Flight X-56 Rhino Stick (Vendor: 0738 Product: 2221)',
      mapping: '',
      connected: true,
      timestamp: 0,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      axes: [0, 0, 0, 0, 0, 0],
    };
    const w = window as unknown as {
      __press: (i: number, down: boolean) => void;
      __axis: (i: number, v: number) => void;
    };
    w.__press = (i, down) => {
      pad.buttons[i] = { pressed: down, touched: down, value: down ? 1 : 0 };
      pad.timestamp++;
    };
    w.__axis = (i, v) => {
      pad.axes[i] = v;
      pad.timestamp++;
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null], configurable: true });
    try {
      Object.defineProperty(Navigator.prototype, 'hid', { get: () => undefined, configurable: true });
    } catch {
      /* ignore */
    }
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
    try {
      localStorage.removeItem('edb.bindings.view');
    } catch {
      /* ignore */
    }
  });
});

async function openFixture(page: Page): Promise<void> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open your bindings file/ }).click();
  await (await chooser).setFiles({ name: 'Custom.4.2.binds', mimeType: 'application/xml', buffer: Buffer.from(FIXTURE) });
  await expect(page).toHaveURL(/\/bindings$/);
}

const press = (page: Page, i: number, down: boolean) =>
  page.evaluate(([i, down]) => (window as unknown as { __press: (i: number, d: boolean) => void }).__press(i, down), [i, down] as const);
const axis = (page: Page, i: number, v: number) =>
  page.evaluate(([i, v]) => (window as unknown as { __axis: (i: number, v: number) => void }).__axis(i, v), [i, v] as const);

test('press a HOTAS button (with a held modifier) to bind a command', async ({ page }) => {
  await openFixture(page);
  await page.getByLabel('Filter commands').fill('LandingGearToggle');
  const row = page.getByRole('row', { name: 'Edit Landing Gear' });
  await row.click();
  const dialog = page.getByRole('dialog');

  // Choose the Secondary slot, then capture.
  await dialog.getByRole('radio', { name: /Secondary/ }).click();
  await dialog.getByRole('button', { name: 'Press to bind' }).click();
  await expect(dialog.getByText('Waiting for input…')).toBeVisible();
  await page.waitForTimeout(300); // capture ignores the first ~150 ms

  // Hold button 5 (Joy_5) as a modifier, tap button 3 (Joy_3), then let go.
  await press(page, 4, true);
  await page.waitForTimeout(100);
  await press(page, 2, true);
  await page.waitForTimeout(100);
  await press(page, 2, false);
  await page.waitForTimeout(100);
  await press(page, 4, false);

  await expect(dialog.getByText('Waiting for input…')).toHaveCount(0);
  const slot = dialog.getByRole('region', { name: 'Secondary slot' });
  await expect(slot).toContainText('X56');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText('X56');

  // The exported file contains the new binding with its modifier, written the game's way.
  const text = await page.evaluate(() => {
    const raw = localStorage.getItem('edb.session');
    return raw ? (JSON.parse(raw) as { current: string }).current : '';
  });
  const block = /<LandingGearToggle>[\s\S]*?<\/LandingGearToggle>/.exec(text)?.[0] ?? '';
  expect(block).toMatch(/<Secondary Device="SaitekX56Joystick" Key="Joy_3">\s*<Modifier Device="SaitekX56Joystick" Key="Joy_5" \/>\s*<\/Secondary>/);
});

test('move a HOTAS axis to bind an axis command', async ({ page }) => {
  await openFixture(page);
  await page.getByLabel('Filter commands').fill('ThrottleAxis');
  const row = page.getByRole('row', { name: 'Edit Throttle Axis' });
  await row.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Press to bind' }).click();
  await expect(dialog.getByText('Waiting for input…')).toBeVisible();
  await page.waitForTimeout(300);

  // Pull the Z axis (index 2) back past the threshold.
  for (const v of [-0.3, -0.6, -0.8, -0.8]) {
    await axis(page, 2, v);
    await page.waitForTimeout(60);
  }
  await expect(dialog.getByText('Waiting for input…')).toHaveCount(0);
  await expect(dialog.getByRole('region', { name: 'Axis binding slot' })).toContainText('X56');
  // The fixture's throttle is already inverted, so no "Set Inverted" suggestion; the setting is kept.
  await expect(dialog.getByRole('button', { name: 'Set Inverted' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Apply' }).click();

  const text = await page.evaluate(() => (JSON.parse(localStorage.getItem('edb.session') ?? '{}') as { current?: string }).current ?? '');
  const block = /<ThrottleAxis>[\s\S]*?<\/ThrottleAxis>/.exec(text)?.[0] ?? '';
  expect(block).toContain('<Binding Device="SaitekX56Joystick" Key="Joy_ZAxis" />');
  expect(block).toContain('<Inverted Value="1" />');
});
