import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Live input page with faked controllers: navigator.getGamepads returns a
 * mutable fake joystick (Chromium id format) and WebHID is hidden so the
 * Gamepad API path is used.
 */

async function narrow(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 900 });
  // The app shell keeps its nav drawer open; close it to see the page itself.
  if (await page.locator('mat-sidenav').isVisible()) {
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await expect(page.locator('mat-sidenav')).toBeHidden();
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    type FakePad = {
      index: number;
      id: string;
      mapping: string;
      connected: boolean;
      timestamp: number;
      buttons: { pressed: boolean; touched: boolean; value: number }[];
      axes: number[];
    };
    const pad: FakePad = {
      index: 0,
      id: 'Thrustmaster T.Flight Hotas X (Vendor: 044f Product: b108)',
      mapping: '',
      connected: true,
      timestamp: 0,
      buttons: Array.from({ length: 12 }, () => ({ pressed: false, touched: false, value: 0 })),
      // X, Y, Z, (3,4 unused), Rz, U, (7,8), hat on axis 9 (idle ~1.2857)
      axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857],
    };
    const w = window as unknown as {
      __pad: FakePad;
      __press: (i: number, down: boolean) => void;
      __axis: (i: number, v: number) => void;
    };
    w.__pad = pad;
    w.__press = (i, down) => {
      pad.buttons[i] = { pressed: down, touched: down, value: down ? 1 : 0 };
      pad.timestamp++;
    };
    w.__axis = (i, v) => {
      pad.axes[i] = v;
      pad.timestamp++;
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null], configurable: true });
    // Force the Gamepad API path (no permission dialog in tests).
    try {
      Object.defineProperty(Navigator.prototype, 'hid', { get: () => undefined, configurable: true });
    } catch {
      /* ignore */
    }
  });
});

test('shows a gamepad-API joystick, its pressed buttons, hats and axes', async ({ page }) => {
  await page.goto('/live');
  await expect(page.getByRole('heading', { name: 'Live input' })).toBeVisible();
  const card = page.locator('app-live-device-card').first();
  await expect(card).toContainText('Thrustmaster T.Flight Hotas X');
  await expect(card).toContainText('Gamepad API');
  await expect(card).toContainText('044F:B108');
  // Named Elite ID for this VID/PID.
  await expect(card.locator('mat-select').first()).toContainText('ThrustMasterTFlightHOTASX');

  await page.evaluate(() => (window as unknown as { __press: (i: number, d: boolean) => void }).__press(2, true));
  await expect(card.locator('.pressed')).toContainText('Joy_3');
  await expect(page.locator('.what-panel')).toContainText('Joy_3');

  // Hat pushed Right (-0.428 in Chrome's hat encoding).
  await page.evaluate(() => (window as unknown as { __axis: (i: number, v: number) => void }).__axis(9, -0.4286));
  await expect(card.locator('.pressed')).toContainText('Joy_POV1Right');

  await page.evaluate(() => (window as unknown as { __axis: (i: number, v: number) => void }).__axis(0, 0.8));
  await expect(card.locator('.axis.moved [aria-label="Joy_XAxis"]')).toBeVisible();

  await page.evaluate(() => (window as unknown as { __press: (i: number, d: boolean) => void }).__press(2, false));
  await expect(card.locator('.pressed')).not.toContainText('Joy_3');

  await page.getByText('Diagnostics').click();
  await expect(page.locator('.log')).toContainText('Joy_3');
  await expect(page.locator('.log')).toContainText('Joy_POV1Right');
  await expect(page.locator('.dev-diag')).toContainText('mapping="');
  await page.screenshot({ path: 'test-results/shots/live/live-diagnostics-1280.png', fullPage: true });

  await narrow(page);
  await page.screenshot({ path: 'test-results/shots/live/live-e2e-390.png', fullPage: true });
});

test('keyboard presses appear in the event log', async ({ page }) => {
  await page.goto('/live');
  await page.getByText('Diagnostics').click();
  await page.locator('h1').click();
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Shift');
  await expect(page.locator('.log')).toContainText('Key_K');
  await expect(page.locator('.log')).toContainText('Key_LeftShift');
  await expect(page.locator('.what-panel')).toContainText('Key_K');
});

test('what-does-this-do lists commands from the open file', async ({ page }) => {
  await page.addInitScript(() => delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker);
  await page.goto('/');
  const text = readFileSync('src/testing/fixtures/Custom.4.2.binds', 'utf-8');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open your bindings file/ }).click();
  await (await chooser).setFiles({ name: 'Custom.4.2.binds', mimeType: 'application/xml', buffer: Buffer.from(text) });
  await expect(page).toHaveURL(/\/bindings$/);
  await page.getByRole('link', { name: 'Live input' }).click();
  await expect(page.getByRole('heading', { name: 'Live input' })).toBeVisible();
  await page.locator('h1').click();
  // Key_W is bound in the fixture (thrust forward on keyboard).
  await page.keyboard.press('KeyW');
  await expect(page.locator('.what-panel .uses li').first()).toBeVisible();

  // The fake stick is used in the file: joystick button 4 is bound there.
  const card = page.locator('app-live-device-card').first();
  await expect(card).toContainText('in file');
  await page.evaluate(() => (window as unknown as { __press: (i: number, d: boolean) => void }).__press(3, true));
  await expect(page.locator('.what-panel')).toContainText('Joy_4');
  await expect(page.locator('.what-panel .uses li').first()).toBeVisible();
  await expect(page.locator('app-numbering-wizard')).toContainText('Start check');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: 'test-results/shots/live/live-what-1280.png', fullPage: true });
  await narrow(page);
  await page.screenshot({ path: 'test-results/shots/live/live-what-390.png', fullPage: true });
  // No horizontal scrolling at phone width.
  const overflow = await page.evaluate(() => {
    const scroller = document.querySelector('mat-sidenav-content') ?? document.documentElement;
    return scroller.scrollWidth - scroller.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});
